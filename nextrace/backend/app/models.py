from sqlalchemy import Column, Integer, String, Float, Text, ForeignKey, DateTime, Boolean
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
