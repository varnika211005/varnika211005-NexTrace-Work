from sqlalchemy import Column, Integer, String, Float, Text, ForeignKey, DateTime, Boolean, UniqueConstraint
from sqlalchemy.sql import func
from .database import Base


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, autoincrement=True)
    analyst_id = Column(String, unique=True, nullable=False)
    name = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False)  # "investigator" | "admin_investigator"
    status = Column(String, default="Active")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_active = Column(DateTime(timezone=True), nullable=True)


# ---------------------------------------------------------------------------
# Raw evidence sources (each row = one uploaded record, kept verbatim)
# ---------------------------------------------------------------------------
class Person(Base):
    """The case/FIR-level master subject record."""
    __tablename__ = "persons"
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    age = Column(Integer, nullable=True)
    gender = Column(String, nullable=True)
    aliases = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    alt_phone = Column(String, nullable=True)
    address = Column(String, nullable=True)
    city = Column(String, nullable=True)
    vehicle_number = Column(String, nullable=True)
    organization = Column(String, nullable=True)
    case_id = Column(String, nullable=True)
    crime_type = Column(String, nullable=True)
    status = Column(String, nullable=True)
    first_seen = Column(String, nullable=True)
    last_seen = Column(String, nullable=True)
    account_number = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    is_unresolved = Column(Boolean, default=False)  # auto-created placeholder for an unmatched phone/account/plate
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())


class CallRecord(Base):
    __tablename__ = "call_records"
    id = Column(String, primary_key=True)
    caller_phone = Column(String, nullable=False)
    receiver_phone = Column(String, nullable=False)
    timestamp = Column(String, nullable=True)
    duration_seconds = Column(Integer, nullable=True)
    tower_location = Column(String, nullable=True)
    call_type = Column(String, nullable=True)
    source_file = Column(String, default="cdr_records.csv")


class FinancialRecord(Base):
    __tablename__ = "financial_records"
    id = Column(String, primary_key=True)
    sender_account = Column(String, nullable=False)
    receiver_account = Column(String, nullable=False)
    amount = Column(Float, nullable=True)
    timestamp = Column(String, nullable=True)
    transaction_type = Column(String, nullable=True)
    bank = Column(String, nullable=True)
    source_file = Column(String, default="financial_records.csv")


class CCTVSighting(Base):
    __tablename__ = "cctv_sightings"
    id = Column(String, primary_key=True)
    camera_id = Column(String, nullable=True)
    location = Column(String, nullable=True)
    timestamp = Column(String, nullable=True)
    vehicle_number = Column(String, nullable=True)
    name_detected = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    source_file = Column(String, default="cctv_sightings.csv")


class CaseReport(Base):
    __tablename__ = "case_reports"
    id = Column(String, primary_key=True)
    case_id = Column(String, nullable=True)
    title = Column(String, nullable=True)
    date_filed = Column(String, nullable=True)
    officer = Column(String, nullable=True)
    narrative_text = Column(Text, nullable=True)
    source_file = Column(String, default="investigation_reports.csv")


# ---------------------------------------------------------------------------
# Derived / computed during "processing"
# ---------------------------------------------------------------------------
class CaseFile(Base):
    """Lightweight case record, derived from persons + reports on processing."""
    __tablename__ = "cases"
    case_id = Column(String, primary_key=True)
    title = Column(String, nullable=True)
    status = Column(String, default="Under Investigation")
    opened_date = Column(String, nullable=True)


class Relationship(Base):
    """Aggregated pair-level link between two persons, built from ALL evidence sources."""
    __tablename__ = "relationships"
    id = Column(Integer, primary_key=True, autoincrement=True)
    source_id = Column(String, ForeignKey("persons.id"), nullable=False)
    target_id = Column(String, ForeignKey("persons.id"), nullable=False)
    confidence = Column(Float, nullable=False)
    primary_type = Column(String, nullable=False)
    evidence = Column(Text, nullable=False)  # JSON list of evidence dicts (provenance)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class EntityResolutionCandidate(Base):
    """Possible duplicate/alias match between two person records, for admin review."""
    __tablename__ = "entity_resolution_candidates"
    id = Column(Integer, primary_key=True, autoincrement=True)
    person_a_id = Column(String, nullable=False)
    person_b_id = Column(String, nullable=False)
    similarity = Column(Float, nullable=False)
    reasons = Column(Text, nullable=False)  # JSON list of str
    status = Column(String, default="Pending")  # Pending | Confirmed | Rejected
    reviewed_by = Column(String, nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)


class ProcessingJob(Base):
    __tablename__ = "processing_jobs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    status = Column(String, default="Queued")  # Queued|Running|Completed|Failed
    current_stage = Column(String, nullable=True)
    stages_json = Column(Text, nullable=True)  # JSON list of {name, status, records, started_at, finished_at}
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    finished_at = Column(DateTime(timezone=True), nullable=True)
    started_by = Column(String, nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    user = Column(String, nullable=False)
    role = Column(String, nullable=False)
    action = Column(String, nullable=False)
    resource = Column(String, nullable=True)
    case_id = Column(String, nullable=True)
    result = Column(String, default="Success")


class IngestedFile(Base):
    __tablename__ = "ingested_files"
    id = Column(Integer, primary_key=True, autoincrement=True)
    dataset_type = Column(String, nullable=False)  # persons|cdr|financial|cctv|reports
    filename = Column(String, nullable=False)
    uploaded_by = Column(String, nullable=True)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())
    records_count = Column(Integer, default=0)
    status = Column(String, default="Uploaded")  # Uploaded | Processed | Failed


class CaseAccess(Base):
    __tablename__ = "case_access"
    id = Column(Integer, primary_key=True, autoincrement=True)
    case_id = Column(String, nullable=False)
    analyst_id = Column(String, nullable=False)
    access_level = Column(String, default="Read/Write")


class CaseMessage(Base):
    """A message in a case's shared discussion thread - visible to every investigator/admin
    assigned to that case, so co-assigned investigators can coordinate leads and progress."""
    __tablename__ = "case_messages"
    id = Column(Integer, primary_key=True, autoincrement=True)
    case_id = Column(String, nullable=False)
    sender_analyst_id = Column(String, nullable=False)
    sender_name = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PersonAccessGrant(Base):
    """A targeted grant of a single person's full profile to an investigator, independent of
    their case assignments - created when an admin approves a person-level access request."""
    __tablename__ = "person_access_grants"
    id = Column(Integer, primary_key=True, autoincrement=True)
    analyst_id = Column(String, nullable=False)
    person_id = Column(String, nullable=False)
    granted_by = Column(String, nullable=True)
    granted_at = Column(DateTime(timezone=True), server_default=func.now())


class AccessRequest(Base):
    """An investigator's request for access to a case or a specific person outside their
    current assignment. Admin reviews and approves/denies; approval creates the matching grant."""
    __tablename__ = "access_requests"
    id = Column(Integer, primary_key=True, autoincrement=True)
    requested_by = Column(String, nullable=False)
    requester_name = Column(String, nullable=False)
    request_type = Column(String, nullable=False)  # "case" | "person"
    target_id = Column(String, nullable=False)      # a case_id or a person_id
    target_label = Column(String, nullable=True)     # human-readable snapshot (name/title) at request time
    reason = Column(Text, nullable=False)
    status = Column(String, default="Pending")       # Pending | Approved | Denied
    admin_note = Column(Text, nullable=True)
    reviewed_by = Column(String, nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ---------------------------------------------------------------------------
# Evidence integrity (SHA-256) + immutable ledger (blockchain-ready adapter)
# ---------------------------------------------------------------------------
class EvidenceHash(Base):
    """App-side registry of the recorded SHA-256 for every raw evidence record.

    This is the value that run-time verification recomputes the current row against.
    The same hash (plus provenance metadata only) is anchored into the immutable
    ledger, so even tampering with this table cannot make a modified record pass.
    """
    __tablename__ = "evidence_hashes"
    __table_args__ = (UniqueConstraint("evidence_type", "record_id", name="uq_evidence_record"),)
    id = Column(Integer, primary_key=True, autoincrement=True)
    evidence_type = Column(String, nullable=False)  # call_record|financial_record|cctv_sighting|case_report|person|biometric
    record_id = Column(String, nullable=False)
    sha256 = Column(String, nullable=False)          # 64-char hex digest of the canonical serialized record
    algorithm = Column(String, default="SHA-256")
    sealed_at = Column(DateTime(timezone=True), server_default=func.now())
    sealed_by = Column(String, nullable=True)


class LedgerBlock(Base):
    """One append-only "block" of the immutable ledger.

    Each block carries a hash of (previous block hash + timestamp + payload), so the
    chain is cryptographically tamper-evident: modifying or reordering any block breaks
    every subsequent block's hash. The payload contains ONLY SHA-256 hashes and
    provenance metadata (evidence type/id, case reference, source file, sealed time) -
    sensitive or raw evidence never enters the ledger. Labeled honestly as an
    "Immutable Ledger / Blockchain-Ready Adapter" - a production deployment would swap
    the HashChainLedger backend for a real chain (e.g. Ethereum / Hyperledger Besu).
    """
    __tablename__ = "ledger_blocks"
    id = Column(Integer, primary_key=True, autoincrement=True)
    index = Column(Integer, nullable=False, unique=True)  # block height (genesis = 0)
    prev_hash = Column(String, nullable=False)            # sha256 of the previous block (genesis: 64 zeros)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    payload = Column(Text, nullable=False)                # JSON list of {evidence_type, record_id, sha256, ...}
    hash = Column(String, nullable=False)                 # sha256(index|prev_hash|timestamp|payload)


class SecurityEvent(Base):
    """A detected security event - created whenever evidence verification finds a hash
    mismatch (tampering). Events are NEVER deleted by the demo restore process; they form
    the permanent tamper-detection record for admin review."""
    __tablename__ = "security_events"
    id = Column(Integer, primary_key=True, autoincrement=True)
    event_type = Column(String, default="integrity_violation")
    severity = Column(String, default="HIGH")
    evidence_type = Column(String, nullable=False)
    record_id = Column(String, nullable=False)
    case_id = Column(String, nullable=True)
    expected_hash = Column(String, nullable=False)  # hash recorded at seal time / in the ledger
    current_hash = Column(String, nullable=False)   # hash recomputed at verification time
    detected_by = Column(String, nullable=True)
    detected_at = Column(DateTime(timezone=True), server_default=func.now())
    description = Column(Text, nullable=True)
    status = Column(String, default="Open")  # Open | Acknowledged


class CaseStatusHistory(Base):
    """Permanent audit trail of every case-status change: previous status -> new status,
    who changed it, when, and why."""
    __tablename__ = "case_status_history"
    id = Column(Integer, primary_key=True, autoincrement=True)
    case_id = Column(String, nullable=False)
    previous_status = Column(String, nullable=False)
    new_status = Column(String, nullable=False)
    changed_by = Column(String, nullable=False)
    changed_at = Column(DateTime(timezone=True), server_default=func.now())
    comment = Column(Text, nullable=True)


class BackupRecord(Base):
    """Admin-created backup of all case data, written as a gzipped JSON manifest.
    The backup file's own SHA-256 is recorded here for integrity of the backup itself.
    (Automated restore is documented as a future capability, not implemented.)"""
    __tablename__ = "backup_records"
    id = Column(Integer, primary_key=True, autoincrement=True)
    filename = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by = Column(String, nullable=False)
    status = Column(String, default="Completed")
    size_bytes = Column(Integer, default=0)
    sha256 = Column(String, nullable=True)
    records = Column(Text, nullable=True)  # JSON snapshot of per-table record counts


class BiometricEvidence(Base):
    """Biometric evidence reference - PROVENANCE AND METADATA ONLY.

    Stores where/when a biometric sample (face/fingerprint/voice reference) was collected
    and which subject it belongs to. No templates, no raw biometric data, and no match
    scores are stored or computed in this prototype: biometric matching is an advanced /
    future capability exposed through the BiometricsBackend adapter. Until a real engine
    is connected, the backend reports "not configured" rather than fabricating results."""
    __tablename__ = "biometric_evidence"
    id = Column(Integer, primary_key=True, autoincrement=True)
    person_id = Column(String, nullable=True)
    person_name = Column(String, nullable=True)
    modality = Column(String, nullable=False)      # face | fingerprint | voice
    source_file = Column(String, nullable=True)    # reference sheet / collection record
    captured_at = Column(String, nullable=True)
    location = Column(String, nullable=True)
    case_id = Column(String, nullable=True)
    provenance_notes = Column(Text, nullable=True)
    algorithm = Column(String, default="Not Configured")  # matcher engine label once connected
    status = Column(String, default="Stored")             # Stored | Cancelled
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class DemoTamperRecord(Base):
    """Snapshot of a DEMO-ONLY controlled tamper applied to a single evidence record.

    Stores the exact ORIGINAL value so the demo can be safely reverted without corrupting
    the seeded dataset. Restoring a tamper marks this row 'Reverted' but NEVER deletes the
    SecurityEvent, audit entries, or ledger history that documented the violation."""
    __tablename__ = "demo_tamper_records"
    id = Column(Integer, primary_key=True, autoincrement=True)
    evidence_type = Column(String, nullable=False)
    record_id = Column(String, nullable=False)
    field_name = Column(String, nullable=False)
    original_value = Column(Text, nullable=False)
    tampered_value = Column(Text, nullable=False)
    case_id = Column(String, nullable=True)
    applied_at = Column(DateTime(timezone=True), server_default=func.now())
    applied_by = Column(String, nullable=False)
    status = Column(String, default="Active")  # Active | Reverted
    restored_at = Column(DateTime(timezone=True), nullable=True)
    restored_by = Column(String, nullable=True)