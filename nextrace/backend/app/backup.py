"""
Admin backup: writes a gzipped JSON manifest of all case data to backend/backups/ and records
its own SHA-256. Restore is intentionally NOT implemented in this prototype - overwriting a
live investigation database is dangerous - and is documented as a future capability in the UI
and the implementation report.
"""
import gzip
import hashlib
import json
import os
from datetime import datetime

from sqlalchemy.orm import Session

from . import models

BACKUP_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backups")

# Order matters for the manifest readability only.
BACKUP_TABLES = [
    ("persons", models.Person),
    ("call_records", models.CallRecord),
    ("financial_records", models.FinancialRecord),
    ("cctv_sightings", models.CCTVSighting),
    ("case_reports", models.CaseReport),
    ("cases", models.CaseFile),
    ("relationships", models.Relationship),
    ("entity_resolution_candidates", models.EntityResolutionCandidate),
    ("case_access", models.CaseAccess),
    ("case_messages", models.CaseMessage),
    ("person_access_grants", models.PersonAccessGrant),
    ("access_requests", models.AccessRequest),
    ("audit_logs", models.AuditLog),
    ("evidence_hashes", models.EvidenceHash),
    ("case_status_history", models.CaseStatusHistory),
    ("biometric_evidence", models.BiometricEvidence),
]

# The immutable ledger is not part of the backup (it is its own append-only record) and user
# accounts are preserved independently. demo_tamper_records / security_events are operational
# history, intentionally excluded from restoration payloads.


def _row_to_dict(row) -> dict:
    out = {}
    for col in row.__table__.columns:
        v = getattr(row, col.name)
        if isinstance(v, datetime):
            out[col.name] = v.isoformat()
        elif isinstance(v, bool):
            out[col.name] = v
        elif v is None:
            out[col.name] = None
        else:
            out[col.name] = v
    return out


def create_backup(db: Session, created_by: str):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    tables = {}
    for name, model in BACKUP_TABLES:
        tables[name] = [_row_to_dict(r) for r in db.query(model).all()]

    manifest = {
        "schema_version": "1.0",
        "created_at": datetime.utcnow().isoformat(),
        "created_by": created_by,
        "tables": tables,
    }

    filename = f"nextrace_backup_{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}.json.gz"
    filepath = os.path.join(BACKUP_DIR, filename)
    raw = json.dumps(manifest, ensure_ascii=False).encode("utf-8")
    compressed = gzip.compress(raw)
    with open(filepath, "wb") as fh:
        fh.write(compressed)

    sha256 = hashlib.sha256(compressed).hexdigest()
    counts = {name: len(rows) for name, rows in tables.items()}

    rec = models.BackupRecord(filename=filename, created_by=created_by,
                              size_bytes=len(compressed), sha256=sha256,
                              records=json.dumps(counts))
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return {
        "id": rec.id, "filename": filename, "created_at": rec.created_at.isoformat(),
        "created_by": created_by, "size_bytes": rec.size_bytes, "sha256": sha256,
        "records": counts,
    }


def list_backups(db: Session):
    rows = db.query(models.BackupRecord).order_by(models.BackupRecord.id.desc()).all()
    return [{
        "id": r.id, "filename": r.filename, "created_at": r.created_at.isoformat() if r.created_at else None,
        "created_by": r.created_by, "status": r.status, "size_bytes": r.size_bytes,
        "sha256": r.sha256, "records": json.loads(r.records) if r.records else {},
    } for r in rows]


def backup_path(db: Session, backup_id: int):
    rec = db.query(models.BackupRecord).get(backup_id)
    if not rec:
        return None, None
    filepath = os.path.join(BACKUP_DIR, rec.filename)
    if not os.path.exists(filepath):
        return None, None
    return filepath, rec