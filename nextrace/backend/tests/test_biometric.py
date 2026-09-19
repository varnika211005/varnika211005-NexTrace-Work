def test_register_biometric_metadata(client, admin_headers):
    r = client.post("/api/admin/evidence/biometric/register", headers=admin_headers,
                    json={"person_id": "P-0001", "person_name": "Vikram Sagar",
                          "modality": "face", "location": "Tower Intercept Point 3",
                          "captured_at": "2026-09-01T10:00:00", "case_id": "2026-001",
                          "provenance_notes": "Reference image sheet received from state cyber cell."})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["match_available"] is False
    assert body["modality"] == "face"

    rows = client.get("/api/evidence/biometric", headers=admin_headers).json()
    assert any(b["id"] == body["id"] for b in rows)


def test_biometric_match_honest_unavailable(client, admin_headers):
    rows = client.get("/api/evidence/biometric", headers=admin_headers).json()
    assert rows, "expected at least one biometric record from previous test"
    bid = rows[0]["id"]
    r = client.post(f"/api/evidence/biometric/{bid}/match", headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["configured"] is False
    assert body["match_available"] is False
    assert body["matches"] == []
    assert "advanced/future capability" in body["reason"].lower()


def test_biometric_modality_validation(client, admin_headers):
    r = client.post("/api/admin/evidence/biometric/register", headers=admin_headers,
                    json={"modality": "iris", "person_id": "P-0001"})
    assert r.status_code == 400


def test_biometric_sealed_into_integrity(client, admin_headers, processed):
    rows = client.get("/api/evidence/biometric", headers=admin_headers).json()
    if not rows:
        return
    bid = rows[0]["id"]
    r = client.get(f"/api/evidence/Biometric/{bid}", headers=admin_headers)
    assert r.status_code == 200, r.text
    integrity = r.json()["integrity"]
    assert integrity is not None
    assert integrity["status"] in ("verified", "violation")


def test_biometric_visible_in_repository(client, admin_headers, processed):
    items = client.get("/api/evidence", headers=admin_headers).json()
    assert any(i["evidence_type"] == "Biometric" for i in items), \
        "biometric metadata must surface in the Evidence Repository"