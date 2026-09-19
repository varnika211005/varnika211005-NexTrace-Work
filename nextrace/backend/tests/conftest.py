import os
import pathlib
import shutil
import tempfile
import time

# Critical: point DATABASE_URL at a fresh temp sqlite BEFORE importing app.main, so the
# session-scoped fixtures operate on an empty, throwaway database - never the dev DB.
_TMP = tempfile.mkdtemp(prefix="nextrace_test_")
os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(_TMP, 'test.db').replace(os.sep, '/')}"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.database import SessionLocal  # noqa: E402

SAMPLE = pathlib.Path(__file__).resolve().parent.parent.parent / "sample_dataset"

UPLOADS = ["persons", "cdr", "financial", "cctv", "reports"]

DATASET_FILES = {
    "persons": "persons.csv",
    "cdr": "cdr_records.csv",
    "financial": "financial_records.csv",
    "cctv": "cctv_sightings.csv",
    "reports": "investigation_reports.csv",
}


def _login(client, analyst_id, password):
    r = client.post("/api/auth/login", json={"analyst_id": analyst_id, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _upload(client, admin_headers, dataset):
    filename = DATASET_FILES[dataset]
    with open(SAMPLE / filename, "rb") as fh:
        r = client.post(f"/api/admin/ingestion/upload/{dataset}", headers=admin_headers,
                        files={"file": (filename, fh, "text/csv")},
                        data={"mode": "append"})
    assert r.status_code == 200, r.text
    return r.json()


def _wait_for_job(client, admin_headers, job_id, timeout_s=20.0):
    deadline = time.time() + timeout_s
    last = None
    while time.time() < deadline:
        last = client.get(f"/api/admin/processing/jobs/{job_id}", headers=admin_headers).json()
        if last["status"] in ("Completed", "Failed"):
            return last
        time.sleep(0.25)
    raise AssertionError(f"Job {job_id} did not finish in {timeout_s}s (last status: {last['status']})")


@pytest.fixture(scope="session")
def client():
    return TestClient(app)


@pytest.fixture(scope="session")
def admin_headers(client):
    return _login(client, "ADMIN01", "admin123")


@pytest.fixture(scope="session")
def inv_headers(client):
    return _login(client, "INV204", "investigator123")


@pytest.fixture(scope="session")
def seeded(client, admin_headers):
    """All five sample datasets ingested (seal-on-ingest runs automatically)."""
    for ds in UPLOADS:
        _upload(client, admin_headers, ds)
    return True


@pytest.fixture(scope="session")
def processed(client, admin_headers, seeded):
    r = client.post("/api/admin/processing/start", headers=admin_headers)
    assert r.status_code == 200, r.text
    job = _wait_for_job(client, admin_headers, r.json()["job_id"])
    assert job["status"] == "Completed", job
    return job["id"]


@pytest.fixture(scope="session")
def sample_cdr_id(client, admin_headers, processed):
    items = client.get("/api/evidence", headers=admin_headers).json()
    cdrs = [i for i in items if i["evidence_type"] == "CDR"]
    assert cdrs, "no CDR evidence after seeding"
    return cdrs[0]["id"]


@pytest.fixture(scope="session")
def sample_case_id(client, admin_headers, processed):
    cases = client.get("/api/cases", headers=admin_headers).json()
    assert cases, "no cases after processing"
    return cases[0]["case_id"]


@pytest.fixture(autouse=True)
def _teardown(tmp_path_factory):
    """Clean up the temp SQLite dir at the very end of the session."""
    yield
    shutil.rmtree(_TMP, ignore_errors=True)