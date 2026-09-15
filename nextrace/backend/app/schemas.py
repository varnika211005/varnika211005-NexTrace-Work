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
