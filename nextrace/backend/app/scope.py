"""
Case-scoped access control for Investigators.

Admin Investigators always see everything (unchanged behavior). An Investigator only sees:

  - "primary" persons: everyone in a case they're assigned to (via CaseAccess), plus anyone
    individually granted to them (via PersonAccessGrant, created when an admin approves a
    person-level access request).

  - "bridge" persons: someone OUTSIDE their assigned cases who has a direct relationship to a
    primary person. Bridge persons are visible only as a connection - name, id, and the specific
    relationship/evidence tying them back to a primary person - not their full profile, evidence,
    timeline, or other relationships. This is what lets an investigator notice "this case touches
    another case" without that other case's data being fully exposed to them.

A Scope is computed fresh per request (assignments and grants change over time) and used by
every read endpoint that needs to filter results for an Investigator.
"""
from dataclasses import dataclass, field
from typing import Set
import json
from sqlalchemy.orm import Session
from sqlalchemy import or_

from . import models


@dataclass
class Scope:
    is_admin: bool
    case_ids: Set[str] = field(default_factory=set)
    primary_ids: Set[str] = field(default_factory=set)
    bridge_ids: Set[str] = field(default_factory=set)

    @property
    def visible_ids(self) -> Set[str]:
        return self.primary_ids | self.bridge_ids

    def can_see_case(self, case_id: str) -> bool:
        return self.is_admin or case_id in self.case_ids

    def person_access(self, person_id: str) -> str:
        """Returns 'full', 'bridge', or 'none'."""
        if self.is_admin or person_id in self.primary_ids:
            return "full"
        if person_id in self.bridge_ids:
            return "bridge"
        return "none"


def get_scope(db: Session, user: models.User) -> Scope:
    if user.role == "admin_investigator":
        return Scope(is_admin=True)

    access_rows = db.query(models.CaseAccess).filter(models.CaseAccess.analyst_id == user.analyst_id).all()
    case_ids = {r.case_id for r in access_rows}

    primary_ids: Set[str] = set()
    if case_ids:
        persons_in_cases = db.query(models.Person).filter(models.Person.case_id.in_(case_ids)).all()
        primary_ids = {p.id for p in persons_in_cases}

    grants = db.query(models.PersonAccessGrant).filter(models.PersonAccessGrant.analyst_id == user.analyst_id).all()
    primary_ids |= {g.person_id for g in grants}

    bridge_ids: Set[str] = set()
    if primary_ids:
        rels = db.query(models.Relationship).filter(
            or_(models.Relationship.source_id.in_(primary_ids), models.Relationship.target_id.in_(primary_ids))
        ).all()
        for r in rels:
            if r.source_id not in primary_ids:
                bridge_ids.add(r.source_id)
            if r.target_id not in primary_ids:
                bridge_ids.add(r.target_id)

    return Scope(is_admin=False, case_ids=case_ids, primary_ids=primary_ids, bridge_ids=bridge_ids)


def bridge_relationships_for(db: Session, scope: Scope, bridge_person_id: str):
    """The specific relationship(s) connecting a bridge person back into the investigator's
    primary scope - this is ALL of a bridge person's data an Investigator is allowed to see."""
    rels = db.query(models.Relationship).filter(
        or_(models.Relationship.source_id == bridge_person_id, models.Relationship.target_id == bridge_person_id)
    ).all()
    return [r for r in rels if (r.source_id in scope.primary_ids or r.target_id in scope.primary_ids)]


def visible_relationship_query(db: Session, sc: Scope):
    """All Relationship rows an Investigator may see: at least one side must be a primary
    (fully-owned) person - this excludes bridge-to-bridge edges, so the graph can't be used to
    route/expand into a case the investigator has no assignment or grant for."""
    q = db.query(models.Relationship)
    if sc.is_admin:
        return q.all()
    return [r for r in q.all() if r.source_id in sc.primary_ids or r.target_id in sc.primary_ids]


def build_visible_graph(db: Session, sc: Scope):
    """A NetworkX graph containing only what this scope can see - same node/edge restriction as
    the /graph endpoint, used for analytics and path-finding so neither can reveal hidden data."""
    import networkx as nx
    G = nx.Graph()
    persons = db.query(models.Person).all()
    if not sc.is_admin:
        persons = [p for p in persons if p.id in sc.visible_ids]
    for p in persons:
        G.add_node(p.id, name=p.name, crime_type=p.crime_type, case_id=p.case_id)
    for r in visible_relationship_query(db, sc):
        G.add_edge(r.source_id, r.target_id, confidence=r.confidence, primary_type=r.primary_type,
                   evidence=json.loads(r.evidence))
    return G


def visible_evidence_ids(db: Session, sc: Scope):
    """Returns (call_ids, financial_ids, cctv_ids, report_ids) visible to this scope - each a set
    of raw-record ids, or None (meaning unrestricted) for an admin. Only PRIMARY (fully-owned)
    persons contribute evidence here - bridge persons' unrelated raw activity stays hidden, only
    the specific relationship linking them into scope is ever shown (see bridge_relationships_for)."""
    if sc.is_admin:
        return None, None, None, None
    if not sc.primary_ids:
        return set(), set(), set(), set()

    primary = db.query(models.Person).filter(models.Person.id.in_(sc.primary_ids)).all()
    phones, accounts, vehicles, name_tokens, case_ids = set(), set(), set(), set(), set()
    for p in primary:
        if p.phone:
            phones.add(p.phone)
        if p.alt_phone:
            phones.add(p.alt_phone)
        if p.account_number:
            accounts.add(p.account_number)
        if p.vehicle_number:
            vehicles.add(p.vehicle_number)
        for t in ([p.name] + (p.aliases.split("|") if p.aliases else [])):
            if t and len(t.strip()) >= 3:
                name_tokens.add(t.strip().lower())
        if p.case_id:
            case_ids.add(p.case_id)

    call_ids = {c.id for c in db.query(models.CallRecord).all()
                if c.caller_phone in phones or c.receiver_phone in phones}
    financial_ids = {t.id for t in db.query(models.FinancialRecord).all()
                      if t.sender_account in accounts or t.receiver_account in accounts}
    cctv_ids = {s.id for s in db.query(models.CCTVSighting).all()
                if (s.vehicle_number and s.vehicle_number in vehicles)
                or (s.name_detected and s.name_detected.strip().lower() in name_tokens)}
    report_ids = {r.id for r in db.query(models.CaseReport).all()
                  if r.case_id in case_ids
                  or (r.narrative_text and any(tok in r.narrative_text.lower() for tok in name_tokens))}
    return call_ids, financial_ids, cctv_ids, report_ids