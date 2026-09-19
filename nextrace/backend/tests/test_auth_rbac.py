def test_login_success(client):
    r = client.post("/api/auth/login", json={"analyst_id": "ADMIN01", "password": "admin123"})
    assert r.status_code == 200
    body = r.json()
    assert body["token"]
    assert body["user"]["role"] == "admin_investigator"


def test_login_wrong_password(client):
    r = client.post("/api/auth/login", json={"analyst_id": "ADMIN01", "password": "wrong"})
    assert r.status_code == 401


def test_me(client, admin_headers):
    r = client.get("/api/auth/me", headers=admin_headers)
    assert r.status_code == 200
    assert r.json()["analyst_id"] == "ADMIN01"


def test_unauthenticated_denied(client):
    assert client.get("/api/dashboard").status_code == 401
    assert client.get("/api/admin/security").status_code == 401


def test_admin_only_endpoint_forbidden_for_investigator(client, inv_headers):
    for path, method in [
        ("/api/admin/security", "get"),
        ("/api/admin/evidence/seal", "post"),
        ("/api/admin/ledger", "get"),
        ("/api/admin/backup", "post"),
    ]:
        r = getattr(client, method)(path, headers=inv_headers)
        assert r.status_code == 403, f"{path} should be admin-only"