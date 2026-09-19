"""
Evidence SHA-256 integrity layer.

Every raw evidence record is reduced to a canonical deterministic JSON payload and hashed
(sha256). The recorded hash lives in the EvidenceHash table (app-side registry) and is ALSO
anchored into the immutable ledger (ledger.py). Verification recomputes the hash of the
current DB row and compares it against the recorded value + ledger, so ANY modification to
a sealed record - including tampering with the registry itself - is detected.

Also owns the DEMO-ONLY controlled tamper tooling (preserve -> alter -> restore) so the
acceptance demo can prove verifiable tamper detection WITHOUT permanently corrupting the
seeded dataset.
"""
import json
from datetime import datetime

from sqlalchemy.orm import Session

from . import models, ledger

# evidence_type key -> (frontend label, SQLAlchemy model)
EVIDENCE_TYPES = {
    "call_record": ("CDR", models.CallRecord),
    "financial_record": ("Financial", models.FinancialRecord),
    "cctv_sighting": ("CCTV", models.CCTVSighting),
    "case_report": ("Report", models.CaseReport),
    "person": ("Person", models.Person),
    "biometric": ("Biometric", models.BiometricEvidence),
}

LABEL_TO_KEY = {label: key for key, (label, _) in EVIDENCE_TYPES.items()}


def normalize_evidence_type(value):
    """Resolve a caller-provided evidence type to the canonical DB key.

    Accepts EITHER the canonical key as stored (e.g. "call_record") OR the frontend
    display label (e.g. "CDR"), so API callers never hit "Unknown evidence type."
    because they passed one form while an endpoint expected the other. Returns the
    canonical key, or None when the value matches neither form."""
    if value in EVIDENCE_TYPES:
        return value
    return LABEL_TO_KEY.get(value)

# Tamperable fields that make the demo demonstration intuitive; other columns are also
# allowed but these give a sensible default in the UI.
DEMO_TAMPER_FIELDS = {
    "call_record": "duration_seconds",
    "financial_record": "amount",
    "cctv_sighting": "description",
    "case_report": "narrative_text",
    "person": "address",
}


def sha256_hex(text: str) -> str:
    import hashlib
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _serialize(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return ""
    if isinstance(value, float):
        return repr(value)
    return str(value)


def canonical_payload(model, row) -> str:
    """Deterministic JSON payload for a single raw evidence row (sorted keys, stable scalars)."""
    payload = {col.name: _serialize(getattr(row, col.name)) for col in model.__table__.columns}
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def hash_record(evidence_type: str, row) -> str:
    model = EVIDENCE_TYPES[evidence_type][1]
    return sha256_hex(canonical_payload(model, row))


def _coerce(model, field_name: str, value):
    """Coerce a raw string back to the column's Python type (int/float/bool/str)."""
    col = getattr(model, field_name).property.columns[0]
    if value == "" or value is None:
        return None
    pytype = col.type.python_type
    if pytype is int:
        return int(float(value))
    if pytype is float:
        return float(value)
    if pytype is bool:
        return str(value).strip().lower() in ("true", "1", "yes")
    return str(value)


def _case_id_for(db: Session, evidence_type: str, row) -> str:
    """Best-effort case linkage for a raw record, used to tie alerts back to cases."""
    if evidence_type == "case_report":
        return getattr(row, "case_id", None)
    if evidence_type == "person":
        return getattr(row, "case_id", None)
    if evidence_type == "biometric":
        return getattr(row, "case_id", None)
    if evidence_type == "call_record":
        phones = {row.caller_phone, row.receiver_phone}
        for p in db.query(models.Person).filter(models.Person.is_unresolved == False).all():
            if p.phone in phones or p.alt_phone in phones:
                return p.case_id
    elif evidence_type == "financial_record":
        accounts = {row.sender_account, row.receiver_account}
        for p in db.query(models.Person).filter(models.Person.is_unresolved == False).all():
            if p.account_number in accounts:
                return p.case_id
    elif evidence_type == "cctv_sighting":
        for p in db.query(models.Person).filter(models.Person.is_unresolved == False).all():
            if p.vehicle_number and row.vehicle_number == p.vehicle_number:
                return p.case_id
            for name_token in [p.name] + (p.aliases.split("|") if p.aliases else []):
                if name_token and row.name_detected and row.name_detected.strip().lower() == name_token.strip().lower():
                    return p.case_id
    return None


def _iter_rows(db: Session, evidence_type: str):
    model = EVIDENCE_TYPES[evidence_type][1]
    for row in db.query(model).all():
        # Unresolved placeholder persons are DERIVED at processing time, not raw evidence -
        # they never get sealed.
        if evidence_type == "person" and getattr(row, "is_unresolved", False):
            continue
        yield row


def _active_tamper_keys(db: Session):
    return {(t.evidence_type, t.record_id) for t in db.query(models.DemoTamperRecord)
            .filter(models.DemoTamperRecord.status == "Active").all()}


def seal_evidence(db: Session, sealed_by: str):
    """Recompute/hash every raw evidence record, upsert EvidenceHash, and anchor NEW or
    CHANGED hashes into one new ledger block. Records currently under an Active demo tamper
    are skipped so the recorded (original) hash is never silently re-anchored to the tampered
    value. Returns counts."""
    active = _active_tamper_keys(db)
    ledger_entries = []
    new_count = changed_count = unchanged_count = 0

    for evidence_type in EVIDENCE_TYPES:
        for row in _iter_rows(db, evidence_type):
            digest = hash_record(evidence_type, row)
            existing = db.query(models.EvidenceHash).filter(
                models.EvidenceHash.evidence_type == evidence_type,
                models.EvidenceHash.record_id == str(getattr(row, "id")),
            ).first()
            if (evidence_type, str(getattr(row, "id"))) in active:
                unchanged_count += 1
                continue
            if existing and existing.sha256 == digest:
                unchanged_count += 1
                continue
            if existing:
                existing.sha256 = digest
                changed_count += 1
            else:
                db.add(models.EvidenceHash(evidence_type=evidence_type,
                                           record_id=str(getattr(row, "id")),
                                           sha256=digest, sealed_by=sealed_by))
                new_count += 1
            ledger_entries.append({
                "evidence_type": evidence_type,
                "record_id": str(getattr(row, "id")),
                "sha256": digest,
                "case_id": _case_id_for(db, evidence_type, row),
                "source_file": getattr(row, "source_file", None),
            })
    db.commit()

    if ledger_entries:
        ldb = ledger.HashChainLedger(db)
        ldb.append_block({"kind": "evidence_seal", "sealed_by": sealed_by,
                          "sealed_at": datetime.utcnow().isoformat(), "records": ledger_entries})
    return {"hashed": new_count + changed_count, "unchanged": unchanged_count,
            "new": new_count, "changed": changed_count}


def integrity_summary(db: Session, evidence_type: str, record_id: str):
    """Lightweight status for list/detail views: verified | violation | not_sealed."""
    if evidence_type not in EVIDENCE_TYPES:
        return None
    model = EVIDENCE_TYPES[evidence_type][1]
    row = db.query(model).get(record_id)
    if not row:
        return None
    current = hash_record(evidence_type, row)
    recorded = db.query(models.EvidenceHash).filter(
        models.EvidenceHash.evidence_type == evidence_type,
        models.EvidenceHash.record_id == record_id,
    ).first()
    if not recorded:
        return {"status": "not_sealed", "recorded_hash": None, "current_hash": current}
    status = "verified" if recorded.sha256 == current else "violation"
    return {"status": status, "recorded_hash": recorded.sha256, "current_hash": current}


def verify_record(db: Session, evidence_type: str, record_id: str, detected_by: str):
    """Full cryptographic verification of a single evidence record against the app registry
    AND the immutable ledger. On mismatch a SecurityEvent is created (permanent - never
    deleted by demo restore)."""
    model = EVIDENCE_TYPES[evidence_type][1]
    row = db.query(model).get(record_id)
    if not row:
        raise ValueError("record_not_found")

    current = hash_record(evidence_type, row)
    recorded = db.query(models.EvidenceHash).filter(
        models.EvidenceHash.evidence_type == evidence_type,
        models.EvidenceHash.record_id == record_id,
    ).first()

    ldb = ledger.HashChainLedger(db)
    chain = ldb.verify_chain(db)
    ledger_ref = ldb.find_record(db, evidence_type, record_id)

    if not recorded:
        return {"status": "not_sealed", "verified": None, "recorded_hash": None,
                "current_hash": current, "ledger_block_index": ledger_ref[0] if ledger_ref else None,
                "ledger_chain_valid": chain["valid"]}

    verified = recorded.sha256 == current
    if not verified:
        existing_open = db.query(models.SecurityEvent).filter(
            models.SecurityEvent.evidence_type == evidence_type,
            models.SecurityEvent.record_id == record_id,
            models.SecurityEvent.status == "Open",
        ).order_by(models.SecurityEvent.id.desc()).first()
        if existing_open and existing_open.expected_hash == recorded.sha256:
            existing_open.current_hash = current
            existing_open.detected_at = datetime.utcnow()
            event = existing_open
        else:
            event = models.SecurityEvent(
                event_type="integrity_violation", severity="HIGH",
                evidence_type=evidence_type, record_id=record_id,
                case_id=_case_id_for(db, evidence_type, row),
                expected_hash=recorded.sha256, current_hash=current,
                detected_by=detected_by,
                description=f"SHA-256 integrity mismatch on {evidence_type} record {record_id}.",
            )
            db.add(event)
        db.commit()
        db.refresh(event) if event.id else None
        event_id = event.id
    else:
        event_id = None

    return {
        "status": "violation" if not verified else "verified",
        "verified": verified,
        "integrity_ok": verified,
        "recorded_hash": recorded.sha256, "current_hash": current,
        "ledger_block_index": ledger_ref[0] if ledger_ref else None,
        "ledger_chain_valid": chain["valid"],
        "event_id": event_id,
    }


def simulate_tamper(db: Session, evidence_type: str, record_id: str, field_name: str,
                    tampered_value: str, applied_by: str):
    """DEMO-ONLY. Preserves the original value, then genuinely alters the record so the next
    verification detects a violation. Refuses records that are not yet sealed or that already
    have an Active tamper. The SecurityEvent/AuditLog/Ledger are created by subsequent
    verification and are NEVER removed by the restore step."""
    if evidence_type not in EVIDENCE_TYPES:
        raise ValueError("unknown_evidence_type")
    model = EVIDENCE_TYPES[evidence_type][1]
    row = db.query(model).get(record_id)
    if not row:
        raise ValueError("record_not_found")
    recorded = db.query(models.EvidenceHash).filter(
        models.EvidenceHash.evidence_type == evidence_type,
        models.EvidenceHash.record_id == record_id,
    ).first()
    if not recorded:
        raise ValueError("not_sealed")
    active = db.query(models.DemoTamperRecord).filter(
        models.DemoTamperRecord.evidence_type == evidence_type,
        models.DemoTamperRecord.record_id == record_id,
        models.DemoTamperRecord.status == "Active",
    ).first()
    if active:
        raise ValueError("tamper_already_active")

    col_names = {c.name for c in model.__table__.columns}
    if field_name not in col_names:
        raise ValueError("unknown_field")

    original_raw = getattr(row, field_name)
    original_str = "" if original_raw is None else _serialize(original_raw)
    tampered = _coerce(model, field_name, tampered_value)
    if _serialize(tampered) == original_str:
        raise ValueError("tamper_value_unchanged")

    setattr(row, field_name, tampered)
    db.add(models.DemoTamperRecord(
        evidence_type=evidence_type, record_id=record_id,
        field_name=field_name, original_value=original_str,
        tampered_value=_serialize(tampered) if tampered is not None else "",
        case_id=_case_id_for(db, evidence_type, row), applied_by=applied_by,
    ))
    db.commit()
    return {
        "evidence_type": evidence_type, "record_id": record_id, "field_name": field_name,
        "original_value": original_str,
        "tampered_value": _serialize(tampered) if tampered is not None else "",
    }


def restore_tamper(db: Session, evidence_type: str, record_id: str, restored_by: str):
    """DEMO-ONLY. Restores the EXACT original value captured at tamper time, so the seeded
    dataset is not permanently corrupted. The SecurityEvent / AuditLog / ledger entries that
    documented the violation remain untouched."""
    rec = db.query(models.DemoTamperRecord).filter(
        models.DemoTamperRecord.evidence_type == evidence_type,
        models.DemoTamperRecord.record_id == record_id,
        models.DemoTamperRecord.status == "Active",
    ).first()
    if not rec:
        raise ValueError("no_active_tamper")
    model = EVIDENCE_TYPES[evidence_type][1]
    row = db.query(model).get(record_id)
    if row is not None:
        setattr(row, rec.field_name, _coerce(model, rec.field_name, rec.original_value))
    rec.status = "Reverted"
    rec.restored_by = restored_by
    rec.restored_at = datetime.utcnow()
    db.commit()
    return {"evidence_type": evidence_type, "record_id": record_id,
            "restored_value": rec.original_value}