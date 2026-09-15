import json
import difflib
from collections import defaultdict

import networkx as nx

from .models import Person, Relationship, FinancialRecord
from .analysis import confidence_band, bridge_entities, graph_communities

EVIDENCE_CATEGORIES = ["call", "financial", "cctv", "report", "case", "address", "vehicle", "organization", "notes"]
TIMESTAMPED_CATEGORIES = {"call", "financial", "cctv", "report"}


def _relationships_for(db, person_id):
    rows = db.query(Relationship).filter(
        (Relationship.source_id == person_id) | (Relationship.target_id == person_id)
    ).all()
    out = []
    for r in rows:
        other_id = r.target_id if r.source_id == person_id else r.source_id
        other = db.query(Person).get(other_id)
        out.append({
            "id": r.id, "source_id": person_id, "target_id": other_id,
            "target_name": other.name if other else "Unknown",
            "target_is_unresolved": other.is_unresolved if other else True,
            "confidence": r.confidence, "confidence_band": confidence_band(r.confidence),
            "primary_type": r.primary_type, "evidence": json.loads(r.evidence),
        })
    out.sort(key=lambda x: x["confidence"], reverse=True)
    return out


def generate_entity_summary(person: Person, relationships, G: nx.Graph) -> str:
    name = person.name
    n = len(relationships)

    if person.is_unresolved:
        return (
            f"{name} is an unresolved identifier surfaced from raw evidence (a phone number, "
            f"account, or vehicle plate that does not match any known subject record). "
            f"It has {n} connection(s) to known subjects and may represent an unidentified "
            f"associate worth further investigation."
        )

    if n == 0:
        return (
            f"{name} ({person.crime_type or 'unclassified'}, case {person.case_id or 'N/A'}) "
            f"currently shows no detected connections across any evidence source. This may "
            f"indicate an independent actor, or that linking evidence has not yet been ingested."
        )

    high = [r for r in relationships if r["confidence"] >= 70]
    medium = [r for r in relationships if 40 <= r["confidence"] < 70]
    low = [r for r in relationships if r["confidence"] < 40]
    top = max(relationships, key=lambda r: r["confidence"])
    top_evidence_labels = ", ".join(sorted({e["label"] for e in top["evidence"]}))

    bridges = bridge_entities(G)
    bridge_note = ""
    if person.id in bridges:
        bridge_note = (
            f" {name} acts as a bridge entity, connecting otherwise separate clusters of "
            f"subjects — a high-value node for further investigation."
        )

    contradiction_note = ""
    notes_lower = (person.notes or "").lower()
    if ("no confirmed" in notes_lower or "no known" in notes_lower or "isolated case" in notes_lower) and n > 0:
        contradiction_note = (
            f" Notably, {name}'s own case notes state no associates are known, yet cross-source "
            f"analysis surfaced {n} hidden connection(s) not explicitly recorded anywhere in the "
            f"source text — exactly the kind of lead NexTrace is designed to surface."
        )

    unresolved_note = ""
    unresolved_links = [r for r in relationships if r.get("target_is_unresolved")]
    if unresolved_links:
        unresolved_note = (
            f" {len(unresolved_links)} connection(s) involve unresolved identifiers "
            f"(unknown numbers/accounts/vehicles) that have not yet been matched to a known subject."
        )

    summary = (
        f"{name} ({person.age or '?'}, {person.crime_type or 'unclassified'}) is linked to case "
        f"{person.case_id or 'N/A'}. Cross-source analysis identified {n} associated entit{'y' if n == 1 else 'ies'}: "
        f"{len(high)} high-confidence, {len(medium)} medium-confidence, and {len(low)} low-confidence link(s). "
        f"The strongest connection is to {top['target_name']} ({top['confidence']:.0f}% confidence), "
        f"supported by: {top_evidence_labels}."
        f"{bridge_note}{contradiction_note}{unresolved_note}"
    )
    return summary


def compute_reliability(db, person: Person, relationships, pending_resolution_ids: set) -> dict:
    """Person-level explainable reliability score. Components are averaged for the overall score."""
    if not relationships:
        components = {
            "evidence_strength": 0, "source_reliability": 0,
            "entity_resolution": 100 if person.id not in pending_resolution_ids else 60,
            "temporal_consistency": 0, "cross_source_support": 0,
        }
        overall = round(sum(components.values()) / len(components))
        return {"overall": overall, "components": components}

    evidence_strength = round(sum(r["confidence"] for r in relationships) / len(relationships))

    categories_seen = set()
    for r in relationships:
        for e in r["evidence"]:
            categories_seen.add(e["category"])
    source_reliability = round(min(100, (len(categories_seen) / 5) * 100))

    entity_resolution = 100 if person.id not in pending_resolution_ids else 60

    timestamped_count = sum(
        1 for r in relationships if any(e["category"] in TIMESTAMPED_CATEGORIES for e in r["evidence"])
    )
    temporal_consistency = round((timestamped_count / len(relationships)) * 100)

    high_count = sum(1 for r in relationships if r["confidence"] >= 70)
    cross_source_support = round((high_count / len(relationships)) * 100)

    components = {
        "evidence_strength": evidence_strength,
        "source_reliability": source_reliability,
        "entity_resolution": entity_resolution,
        "temporal_consistency": temporal_consistency,
        "cross_source_support": cross_source_support,
    }
    overall = round(sum(components.values()) / len(components))
    return {"overall": overall, "components": components}


# ---------------------------------------------------------------------------
# Intelligence / pattern indicators (contextual - NOT a standalone alerts page)
# ---------------------------------------------------------------------------
def generate_intelligence_indicators(db, G: nx.Graph):
    indicators = []
    persons = {p.id: p for p in db.query(Person).all()}
    relationships = db.query(Relationship).all()

    # 1. Bridge entities
    bridges = bridge_entities(G, top_n=3)
    for pid in bridges:
        p = persons.get(pid)
        if not p or p.is_unresolved:
            continue
        indicators.append({
            "title": "Bridge Entity",
            "severity": "Medium",
            "confidence": 80,
            "explanation": f"{p.name} connects two or more otherwise-separate clusters of subjects, "
                            f"making them a high-value node for further investigation.",
            "related_entities": [pid],
            "evidence_count": G.degree(pid) if pid in G else 0,
        })

    # 2. Cross-case links (potential coordinated activity across investigations)
    for r in relationships:
        a, b = persons.get(r.source_id), persons.get(r.target_id)
        if not a or not b or a.is_unresolved or b.is_unresolved:
            continue
        if a.case_id and b.case_id and a.case_id != b.case_id and r.confidence >= 40:
            evidence = json.loads(r.evidence)
            labels = ", ".join(sorted({e["label"] for e in evidence}))
            indicators.append({
                "title": "Potential Coordinated Activity Across Cases",
                "severity": "High" if r.confidence >= 70 else "Medium",
                "confidence": r.confidence,
                "explanation": f"{a.name} (case {a.case_id}) and {b.name} (case {b.case_id}) are linked "
                                f"via {labels}, suggesting the two investigations may be connected.",
                "related_entities": [a.id, b.id],
                "evidence_count": len(evidence),
            })

    # 3. Untraced / large fund transfers to unresolved accounts
    known_accounts = {p.account_number for p in persons.values() if not p.is_unresolved and p.account_number}
    for tx in db.query(FinancialRecord).all():
        if tx.receiver_account not in known_accounts and tx.amount and tx.amount >= 100000:
            indicators.append({
                "title": "Large Transfer to Unidentified Account",
                "severity": "High",
                "confidence": 65,
                "explanation": f"₹{tx.amount:,.0f} was transferred from account {tx.sender_account} to "
                                f"{tx.receiver_account}, which does not match any known subject — "
                                f"a potential mule account or untraced fund flow.",
                "related_entities": [],
                "evidence_count": 1,
            })

    # 4. High-confidence dense clusters
    communities = graph_communities(G)
    cluster_members = defaultdict(list)
    for node, comm in communities.items():
        cluster_members[comm].append(node)
    for comm, members in cluster_members.items():
        if len(members) < 3:
            continue
        sub_edges = [d["confidence"] for a, b, d in G.edges(data=True) if a in members and b in members]
        if sub_edges and (sum(sub_edges) / len(sub_edges)) >= 70:
            names = [persons[m].name for m in members if m in persons and not persons[m].is_unresolved][:5]
            indicators.append({
                "title": "High-Confidence Communication Cluster",
                "severity": "Medium",
                "confidence": round(sum(sub_edges) / len(sub_edges)),
                "explanation": f"A tightly-linked group of {len(members)} subjects ({', '.join(names)}"
                                f"{'…' if len(members) > 5 else ''}) shows consistently high-confidence "
                                f"connections across multiple evidence types.",
                "related_entities": members,
                "evidence_count": len(sub_edges),
            })

    return indicators


# ---------------------------------------------------------------------------
# Entity resolution candidates (possible duplicate / alias matches for admin review)
# ---------------------------------------------------------------------------
def generate_resolution_candidates(db):
    persons = [p for p in db.query(Person).all() if not p.is_unresolved]
    candidates = []
    for i in range(len(persons)):
        for j in range(i + 1, len(persons)):
            a, b = persons[i], persons[j]
            name_a, name_b = a.name.lower(), b.name.lower()
            ratio = difflib.SequenceMatcher(None, name_a, name_b).ratio()

            reasons = []
            if 0.55 <= ratio < 0.97:
                reasons.append(f"Name similarity {ratio*100:.0f}% ({a.name} vs {b.name})")
            if a.aliases and b.name.lower() in [al.strip().lower() for al in a.aliases.split("|")]:
                reasons.append(f"{b.name} appears as a recorded alias of {a.name}")
            if b.aliases and a.name.lower() in [al.strip().lower() for al in b.aliases.split("|")]:
                reasons.append(f"{a.name} appears as a recorded alias of {b.name}")
            if a.phone and b.phone and a.phone == b.phone:
                reasons.append("Identical primary phone number on file")

            if reasons:
                candidates.append({
                    "person_a_id": a.id, "person_b_id": b.id,
                    "similarity": round(max(ratio, 0.9 if len(reasons) > 1 else ratio) * 100, 1),
                    "reasons": reasons,
                })
    return candidates
