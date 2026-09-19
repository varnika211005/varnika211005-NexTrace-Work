"""
NexTrace multi-source analysis engine.

Resolves FIVE independent evidence sources into one relationship graph:

    1. Person master records  (profile fields: case, address, vehicle, org, notes)
    2. Call Detail Records    (phone -> phone)
    3. Financial Records      (account -> account)
    4. CCTV Sightings         (vehicle plate / face-match name -> co-location)
    5. Investigation Reports  (free-text narrative -> name mentions)

Every relationship stores WHICH evidence produced it (category, specific
record IDs, source file) so any score in the UI can be traced back to raw
evidence - this is the provenance requirement.

Unmatched phone numbers / account numbers / vehicle plates are not discarded -
they become "unresolved" placeholder Person rows (e.g. "Unknown Number
(9000011122)") so they still show up in the graph as leads worth investigating,
instead of silently vanishing.
"""
import json
import re
from collections import defaultdict
from datetime import datetime

import networkx as nx

from .models import Person, CallRecord, FinancialRecord, CCTVSighting, CaseReport, Relationship

# ---------------------------------------------------------------------------
# Scoring model
# ---------------------------------------------------------------------------
CATEGORY_LABEL = {
    "call": "Direct Contact (Call / SMS)",
    "financial": "Financial Transfer",
    "cctv": "Co-located (CCTV)",
    "report": "Mentioned Together in Report",
    "case": "Co-Accused (Same Case)",
    "address": "Shared Residence / Location",
    "vehicle": "Shared Vehicle Use",
    "organization": "Colleague",
    "notes": "Reported Association",
}


def _score(category: str, count: int) -> int:
    if category == "call":
        return min(50, 25 + (count - 1) * 5)
    if category == "financial":
        return min(45, 25 + (count - 1) * 7)
    if category == "cctv":
        return min(35, 20 + (count - 1) * 10)
    if category == "report":
        return min(30, 20 + (count - 1) * 10)
    return {"case": 25, "address": 20, "vehicle": 18, "organization": 12, "notes": 15}[category]


def _norm(v):
    return "" if v is None else str(v).strip().lower()


def _parse_ts(ts):
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts)
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Resolution helpers - map raw identifiers (phone/account/plate/name) to Person IDs,
# creating "unresolved" placeholder Person rows for anything unmatched.
# ---------------------------------------------------------------------------
class Resolver:
    def __init__(self, db):
        self.db = db
        self.persons = {p.id: p for p in db.query(Person).all()}
        self.phone_to_id = {}
        self.account_to_id = {}
        self.vehicle_to_id = {}
        self.name_to_id = {}
        # Two passes for phone: a person's own PRIMARY phone is always the authoritative owner of
        # that number. alt_phone (a secondary/associate contact number on file) only fills in a
        # number nobody's primary phone already claims - otherwise, if e.g. Ravi's on-file
        # alt_phone happens to equal Arjun's primary phone, whichever person was processed last
        # would silently "steal" ownership of Arjun's own number, misattributing every call to it.
        for p in self.persons.values():
            if p.phone:
                self.phone_to_id[_norm(p.phone)] = p.id
        for p in self.persons.values():
            if p.alt_phone:
                key = _norm(p.alt_phone)
                if key not in self.phone_to_id:
                    self.phone_to_id[key] = p.id
        for p in self.persons.values():
            if p.account_number:
                self.account_to_id[_norm(p.account_number)] = p.id
            if p.vehicle_number:
                self.vehicle_to_id[_norm(p.vehicle_number)] = p.id
            for tok in [p.name] + (p.aliases.split("|") if p.aliases else []):
                if tok:
                    self.name_to_id[_norm(tok.strip())] = p.id
        self._new_unresolved = {}  # id -> Person object (not yet committed)

    def _get_or_create_unresolved(self, kind: str, raw_value: str, crime_label: str):
        pid = f"{kind.upper()}-{raw_value}"
        if pid in self.persons or pid in self._new_unresolved:
            return pid
        p = Person(
            id=pid,
            name=f"Unknown {kind.title()} ({raw_value})",
            crime_type=crime_label,
            status="Unresolved",
            is_unresolved=True,
        )
        self._new_unresolved[pid] = p
        self.persons[pid] = p
        return pid

    def resolve_phone(self, phone):
        if not phone:
            return None
        key = _norm(phone)
        if key in self.phone_to_id:
            return self.phone_to_id[key]
        pid = self._get_or_create_unresolved("phone", phone, "Unresolved Contact")
        self.phone_to_id[key] = pid
        return pid

    def resolve_account(self, account):
        if not account:
            return None
        key = _norm(account)
        if key in self.account_to_id:
            return self.account_to_id[key]
        pid = self._get_or_create_unresolved("account", account, "Unresolved Account")
        self.account_to_id[key] = pid
        return pid

    def resolve_cctv(self, sighting: CCTVSighting):
        if sighting.vehicle_number:
            key = _norm(sighting.vehicle_number)
            if key in self.vehicle_to_id:
                return self.vehicle_to_id[key]
            return self._get_or_create_unresolved("vehicle", sighting.vehicle_number, "Unresolved Vehicle")
        if sighting.name_detected:
            key = _norm(sighting.name_detected)
            if key in self.name_to_id:
                return self.name_to_id[key]
        return None  # nothing usable to resolve against

    def mentioned_person_ids(self, text: str):
        if not text:
            return []
        found = []
        for name_key, pid in self.name_to_id.items():
            if len(name_key) < 3:
                continue
            if re.search(r"\b" + re.escape(name_key) + r"\b", text, flags=re.IGNORECASE):
                found.append(pid)
        return sorted(set(found))

    def flush_new_persons(self):
        for p in self._new_unresolved.values():
            self.db.add(p)
        self.db.commit()
        return len(self._new_unresolved)


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------
def run_full_analysis(db):
    """Rebuild every relationship from scratch across all 5 evidence sources."""
    resolver = Resolver(db)
    evidence_by_pair = defaultdict(lambda: defaultdict(list))  # pair -> category -> [evidence dict]

    def add_evidence(a, b, category, record_id, summary, timestamp=None, source_file=None):
        if not a or not b or a == b:
            return
        pair = tuple(sorted([a, b]))
        evidence_by_pair[pair][category].append({
            "record_id": record_id, "summary": summary,
            "timestamp": timestamp, "source_file": source_file,
        })

    # 1. Profile-based (static fields on Person) -----------------------------
    persons = [p for p in resolver.persons.values() if not p.is_unresolved]
    for i in range(len(persons)):
        for j in range(i + 1, len(persons)):
            a, b = persons[i], persons[j]
            if a.case_id and b.case_id and _norm(a.case_id) == _norm(b.case_id):
                add_evidence(a.id, b.id, "case", a.case_id, f"Both linked to case {a.case_id}", source_file="persons.csv")
            if a.address and b.address and _norm(a.address) == _norm(b.address):
                add_evidence(a.id, b.id, "address", None, f"Same registered address ({a.address})", source_file="persons.csv")
            if a.vehicle_number and b.vehicle_number and _norm(a.vehicle_number) == _norm(b.vehicle_number):
                add_evidence(a.id, b.id, "vehicle", None, f"Same vehicle registration ({a.vehicle_number})", source_file="persons.csv")
            if (a.organization and b.organization and _norm(a.organization) == _norm(b.organization)
                    and _norm(a.organization) != "independent"):
                add_evidence(a.id, b.id, "organization", None, f"Both linked to {a.organization}", source_file="persons.csv")
            a_notes, b_notes = _norm(a.notes), _norm(b.notes)
            a_tokens = [a.name] + (a.aliases.split("|") if a.aliases else [])
            b_tokens = [b.name] + (b.aliases.split("|") if b.aliases else [])
            mentioned = any(_norm(t) and _norm(t) in b_notes for t in a_tokens) or \
                        any(_norm(t) and _norm(t) in a_notes for t in b_tokens)
            if mentioned:
                add_evidence(a.id, b.id, "notes", None, "Named in an associate's case notes", source_file="persons.csv")

    # 2. Call Detail Records ---------------------------------------------------
    for call in db.query(CallRecord).all():
        a = resolver.resolve_phone(call.caller_phone)
        b = resolver.resolve_phone(call.receiver_phone)
        mins = (call.duration_seconds or 0) // 60
        secs = (call.duration_seconds or 0) % 60
        kind = "SMS" if (call.call_type or "").lower() == "sms" else "Call"
        summary = f"{kind} · {call.caller_phone} -> {call.receiver_phone} · {mins}m{secs}s · {call.tower_location or 'unknown tower'}"
        add_evidence(a, b, "call", call.id, summary, timestamp=call.timestamp, source_file="cdr_records.csv")

    # 3. Financial Records -------------------------------------------------
    for tx in db.query(FinancialRecord).all():
        a = resolver.resolve_account(tx.sender_account)
        b = resolver.resolve_account(tx.receiver_account)
        summary = f"{tx.transaction_type or 'Transfer'} of ₹{tx.amount:,.0f} · {tx.sender_account} -> {tx.receiver_account} · {tx.bank or ''}"
        add_evidence(a, b, "financial", tx.id, summary, timestamp=tx.timestamp, source_file="financial_records.csv")

    # 4. CCTV co-location ----------------------------------------------------
    sightings = [s for s in db.query(CCTVSighting).all()]
    resolved_sightings = []
    for s in sightings:
        pid = resolver.resolve_cctv(s)
        ts = _parse_ts(s.timestamp)
        if pid and ts:
            resolved_sightings.append((pid, s, ts))
    by_location = defaultdict(list)
    for pid, s, ts in resolved_sightings:
        by_location[_norm(s.location)].append((pid, s, ts))
    for location, items in by_location.items():
        items.sort(key=lambda x: x[2])
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                pid_a, s_a, ts_a = items[i]
                pid_b, s_b, ts_b = items[j]
                if pid_a == pid_b:
                    continue
                delta_hours = abs((ts_b - ts_a).total_seconds()) / 3600
                if delta_hours <= 3:
                    summary = f"Both observed at {s_a.location} within {delta_hours*60:.0f} min ({s_a.id}, {s_b.id})"
                    add_evidence(pid_a, pid_b, "cctv", f"{s_a.id}/{s_b.id}", summary,
                                 timestamp=s_a.timestamp, source_file="cctv_sightings.csv")

    # 5. Investigation reports (name mentions) --------------------------------
    for r in db.query(CaseReport).all():
        mentioned = resolver.mentioned_person_ids(r.narrative_text or "")
        for i in range(len(mentioned)):
            for j in range(i + 1, len(mentioned)):
                summary = f"Both named in report {r.id} — \"{r.title}\" ({r.date_filed or 'undated'})"
                add_evidence(mentioned[i], mentioned[j], "report", r.id, summary,
                             timestamp=r.date_filed, source_file="investigation_reports.csv")

    # ---- persist unresolved placeholder persons discovered above ----------
    resolver.flush_new_persons()

    # ---- aggregate into Relationship rows -----------------------------------
    db.query(Relationship).delete()
    created = 0
    for (a, b), categories in evidence_by_pair.items():
        category_scores = {}
        evidence_list = []
        for cat, items in categories.items():
            score = _score(cat, len(items))
            category_scores[cat] = score
            evidence_list.append({
                "category": cat,
                "label": CATEGORY_LABEL[cat],
                "count": len(items),
                "score": score,
                "record_ids": [it["record_id"] for it in items if it["record_id"]],
                "source_file": items[0]["source_file"],
                "examples": [it["summary"] for it in items[:5]],
            })
        confidence = min(100, sum(category_scores.values()))
        primary_cat = max(category_scores, key=category_scores.get)
        evidence_list.sort(key=lambda e: e["score"], reverse=True)
        rel = Relationship(
            source_id=a, target_id=b, confidence=confidence,
            primary_type=CATEGORY_LABEL[primary_cat],
            evidence=json.dumps(evidence_list),
        )
        db.add(rel)
        created += 1
    db.commit()
    return created, len(resolver._new_unresolved)


def confidence_band(score: float) -> str:
    if score >= 70:
        return "High"
    if score >= 40:
        return "Medium"
    return "Low"


def build_graph(db) -> nx.Graph:
    G = nx.Graph()
    for p in db.query(Person).all():
        G.add_node(p.id, name=p.name, crime_type=p.crime_type, case_id=p.case_id, is_unresolved=p.is_unresolved)
    for r in db.query(Relationship).all():
        G.add_edge(r.source_id, r.target_id, confidence=r.confidence,
                   primary_type=r.primary_type, evidence=json.loads(r.evidence))
    return G


def graph_communities(G: nx.Graph):
    communities = {}
    for idx, comp in enumerate(nx.connected_components(G)):
        for node in comp:
            communities[node] = idx
    return communities


def bridge_entities(G: nx.Graph, top_n=5):
    if G.number_of_edges() == 0:
        return set()
    bc = nx.betweenness_centrality(G, weight=None)
    ranked = sorted(bc.items(), key=lambda kv: kv[1], reverse=True)
    return {node for node, score in ranked[:top_n] if score > 0}


def node_subtype(person: Person) -> str:
    if not person.is_unresolved:
        return "Person"
    if person.id.startswith("PHONE-"):
        return "Unknown Phone"
    if person.id.startswith("ACCOUNT-"):
        return "Unknown Account"
    if person.id.startswith("VEHICLE-"):
        return "Unidentified Vehicle"
    return "Unresolved"