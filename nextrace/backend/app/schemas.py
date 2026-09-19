from pydantic import BaseModel
from typing import Optional, List


class LoginRequest(BaseModel):
    analyst_id: str
    password: str


class UserCreateRequest(BaseModel):
    analyst_id: str
    name: str
    password: str
    role: str  # "investigator" | "admin_investigator"


class UserUpdateRequest(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    new_password: Optional[str] = None


class AccessAssignRequest(BaseModel):
    case_id: str
    analyst_id: str
    access_level: str = "Read/Write"


class PathRequest(BaseModel):
    source_id: str
    target_id: str


class ResolutionActionRequest(BaseModel):
    note: Optional[str] = None


class ReportGenerateRequest(BaseModel):
    case_id: Optional[str] = None
    person_id: Optional[str] = None
    sections: List[str] = [
        "executive_summary", "subject_profile", "network_overview",
        "relationships", "evidence", "reliability", "pattern_findings", "provenance",
    ]


class CaseMessageCreate(BaseModel):
    message: str


class AccessRequestCreate(BaseModel):
    request_type: str  # "case" | "person"
    target_id: str
    reason: str


class AccessRequestReviewRequest(BaseModel):
    admin_note: Optional[str] = None


class CaseStatusChangeRequest(BaseModel):
    new_status: str
    comment: Optional[str] = None


class SimulateTamperRequest(BaseModel):
    evidence_type: str
    record_id: str
    field_name: str
    tampered_value: str


class RestoreTamperRequest(BaseModel):
    evidence_type: str
    record_id: str


class BiometricRegisterRequest(BaseModel):
    person_id: Optional[str] = None
    person_name: Optional[str] = None
    modality: str  # face | fingerprint | voice
    source_file: Optional[str] = None
    captured_at: Optional[str] = None
    location: Optional[str] = None
    case_id: Optional[str] = None
    provenance_notes: Optional[str] = None