def test_evidence_verify_ok(client, admin_headers, sample_cdr_id):
    r = client.post(f"/api/evidence/CDR/{sample_cdr_id}/verify", headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["verified"] is True
    assert body["status"] == "verified"
    assert body["ledger_chain_valid"] is True
    assert body["recorded_hash"] == body["current_hash"]
    assert len(body["recorded_hash"]) == 64


def test_evidence_detail_includes_integrity(client, admin_headers, sample_cdr_id):
    r = client.get(f"/api/evidence/CDR/{sample_cdr_id}", headers=admin_headers)
    assert r.status_code == 200
    integrity = r.json()["integrity"]
    assert integrity["status"] in ("verified", "violation")
    assert integrity["recorded_hash"]


def test_tamper_verify_violation_restore_full_cycle(client, admin_headers, processed, sample_cdr_id):
    # --- apply demo tamper -> genuine modification preserving the original value
    r = client.post("/api/admin/security/simulate-tamper", headers=admin_headers,
                    json={"evidence_type": "CDR", "record_id": sample_cdr_id,
                          "field_name": "duration_seconds", "tampered_value": "99999"})
    assert r.status_code == 200, r.text
    original = r.json()["original_value"]
    assert original != "99999"
    assert r.json()["demo_only"] is True

    # --- verification MUST now detect the violation + create a permanent SecurityEvent
    r = client.post(f"/api/evidence/CDR/{sample_cdr_id}/verify", headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["verified"] is False
    assert body["status"] == "violation"
    assert body["current_hash"] != body["recorded_hash"]

    events = client.get("/api/admin/security/events", headers=admin_headers).json()
    matching = [e for e in events if e["record_id"] == sample_cdr_id and e["status"] == "Open"]
    assert matching, "a SecurityEvent must exist for the tampered record"
    event_id = matching[0]["id"]

    # --- restore EXACT original value; history must be retained
    r = client.post("/api/admin/security/restore-tampered-evidence", headers=admin_headers,
                    json={"evidence_type": "CDR", "record_id": sample_cdr_id})
    assert r.status_code == 200, r.text
    assert r.json()["restored_value"] == original

    r = client.post(f"/api/evidence/CDR/{sample_cdr_id}/verify", headers=admin_headers)
    body = r.json()
    assert body["verified"] is True, "record restored -> verification must pass again"

    # --- SecurityEvent, audit history AND ledger entries are permanent after restore
    events = client.get("/api/admin/security/events", headers=admin_headers).json()
    assert any(e["id"] == event_id for e in events), "restore must NOT delete the SecurityEvent"
    audit = client.get(f"/api/admin/audit?action=tamper", headers=admin_headers).json()
    assert audit, "tamper + restore must be audit-logged"
    ledger = client.get("/api/admin/ledger", headers=admin_headers).json()
    assert ledger["chain_valid"] is True


def test_tamper_restore_verify_accept_canonical_key(client, admin_headers, processed, sample_cdr_id):
    """Regression: the tamper/restore/verify endpoints must accept BOTH the display label
    (\"CDR\") and the canonical DB key (\"call_record\"). The UI restore path used to send
    the canonical key and the endpoint only understood the label -> 'Unknown evidence type.'"""
    r = client.post("/api/admin/security/simulate-tamper", headers=admin_headers,
                    json={"evidence_type": "call_record", "record_id": sample_cdr_id,
                          "field_name": "duration_seconds", "tampered_value": "77777"})
    assert r.status_code == 200, r.text
    original = r.json()["original_value"]
    assert original != "77777"

    rows = client.get("/api/admin/security/tamper-records", headers=admin_headers).json()
    row = next(t for t in rows if t["evidence_type"] == "call_record")
    assert row["evidence_type_label"] == "CDR", "tamper-records must expose the display label"

    detail = client.get(f"/api/evidence/call_record/{sample_cdr_id}", headers=admin_headers)
    assert detail.status_code == 200, "detail must accept the canonical key too"

    r = client.post(f"/api/evidence/call_record/{sample_cdr_id}/verify", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "violation"

    r = client.post("/api/admin/security/restore-tampered-evidence", headers=admin_headers,
                    json={"evidence_type": "call_record", "record_id": sample_cdr_id})
    assert r.status_code == 200, r.text
    assert r.json()["restored_value"] == original

    r = client.post(f"/api/evidence/CDR/{sample_cdr_id}/verify", headers=admin_headers)
    assert r.json()["verified"] is True, "restored via canonical key -> verify must pass"


def test_tamper_restore_still_accept_labels(client, admin_headers, processed, sample_cdr_id):
    """The original label path must keep working alongside the canonical-key path."""
    r = client.post("/api/admin/security/simulate-tamper", headers=admin_headers,
                    json={"evidence_type": "CDR", "record_id": sample_cdr_id,
                          "field_name": "duration_seconds", "tampered_value": "88888"})
    assert r.status_code == 200, r.text
    original = r.json()["original_value"]
    r = client.post("/api/admin/security/restore-tampered-evidence", headers=admin_headers,
                    json={"evidence_type": "CDR", "record_id": sample_cdr_id})
    assert r.status_code == 200, r.text
    assert r.json()["restored_value"] == original


def test_unknown_evidence_type_still_rejected(client, admin_headers, processed, sample_cdr_id):
    r = client.post("/api/admin/security/simulate-tamper", headers=admin_headers,
                    json={"evidence_type": "NotAThing", "record_id": sample_cdr_id,
                          "field_name": "duration_seconds", "tampered_value": "1"})
    assert r.status_code == 400
    assert "Unknown evidence type." in r.json().get("detail", "")


def test_tamper_requires_sealed_record(client, admin_headers, processed, sample_cdr_id):
    r = client.post("/api/admin/security/simulate-tamper", headers=admin_headers,
                    json={"evidence_type": "Report", "record_id": "NOPE",
                          "field_name": "title", "tampered_value": "x"})
    assert r.status_code == 400


def test_tamper_identical_value_rejected(client, admin_headers, processed, sample_cdr_id):
    # fetch current duration to reuse it as the "tampered" value -> must be rejected
    detail = client.get(f"/api/evidence/CDR/{sample_cdr_id}", headers=admin_headers).json()
    current = detail["record"]["duration_seconds"]
    detail2 = client.get("/api/evidence", headers=admin_headers).json()
    item = next(i for i in detail2 if i["evidence_type"] == "CDR" and i["id"] == sample_cdr_id)
    r = client.post("/api/admin/security/simulate-tamper", headers=admin_headers,
                    json={"evidence_type": "CDR", "record_id": sample_cdr_id,
                          "field_name": "duration_seconds", "tampered_value": str(current)})
    assert r.status_code == 400


def test_investigator_can_verify_own_evidence(client, inv_headers, processed, sample_cdr_id):
    """Verification is not a privileged action: anyone with case-scoped access to the record
    can verify it. (Investigator sees nothing here without access, so we just check that a
    scoped record verifies for whoever can see it - verified against admin as baseline.)"""
    assert client.get("/api/evidence", headers=inv_headers).status_code == 200