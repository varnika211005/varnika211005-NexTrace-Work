import gzip
import hashlib
import io
import json


def test_backup_create_list_download(client, admin_headers, processed):
    r = client.post("/api/admin/backup", headers=admin_headers)
    assert r.status_code == 200, r.text
    info = r.json()
    assert info["filename"].endswith(".json.gz")
    assert info["sha256"]
    assert info["size_bytes"] > 0
    assert info["records"]["persons"] > 0
    backup_id = info["id"]

    listing = client.get("/api/admin/backup", headers=admin_headers).json()
    assert any(b["id"] == backup_id for b in listing), "backup must appear in history"

    d = client.get(f"/api/admin/backup/{backup_id}/download", headers=admin_headers)
    assert d.status_code == 200
    raw = d.content
    assert len(raw) == info["size_bytes"]
    assert hashlib.sha256(raw).hexdigest() == info["sha256"], \
        "downloaded file must match the recorded SHA-256"

    with gzip.open(io.BytesIO(raw), "rt", encoding="utf-8") as fh:
        data = json.load(fh)
    assert data["schema_version"]
    assert data["tables"]["call_records"], "backup payload must include raw evidence"


def test_backup_admin_only(client, admin_headers, inv_headers):
    assert client.post("/api/admin/backup", headers=admin_headers).status_code == 200
    assert client.post("/api/admin/backup", headers=inv_headers).status_code == 403
    assert client.get("/api/admin/backup", headers=inv_headers).status_code == 403


def test_backup_download_requires_admin(client, admin_headers, inv_headers):
    r = client.post("/api/admin/backup", headers=admin_headers)
    backup_id = r.json()["id"]
    assert client.get(f"/api/admin/backup/{backup_id}/download", headers=inv_headers).status_code == 403