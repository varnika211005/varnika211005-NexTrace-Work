import conftest as _c

def test_case_detail_exposes_status_tools(client, admin_headers, sample_case_id):
    r = client.get(f"/api/cases/{sample_case_id}", headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["can_change_status"] is True
    assert "Under Investigation" in body["allowed_statuses"]
    assert "status_history" in body


def test_admin_changes_status_and_history_recorded(client, admin_headers, sample_case_id):
    r = client.post(f"/api/cases/{sample_case_id}/status", headers=admin_headers,
                    json={"new_status": "Solved", "comment": "Principal arrested under POCSO."})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "Solved"
    assert r.json()["previous_status"] == "Under Investigation"

    case = client.get(f"/api/cases/{sample_case_id}", headers=admin_headers).json()
    history = case["status_history"]
    assert history, "status change must create history"
    assert history[0]["new_status"] == "Solved"
    assert history[0]["comment"] == "Principal arrested under POCSO."

    audit = client.get("/api/admin/audit?action=status", headers=admin_headers).json()
    assert any("changed case status" in a["action"].lower() for a in audit)

    # reset to baseline for other tests
    client.post(f"/api/cases/{sample_case_id}/status", headers=admin_headers,
                json={"new_status": "Under Investigation"})


def test_invalid_status_rejected(client, admin_headers, sample_case_id):
    r = client.post(f"/api/cases/{sample_case_id}/status", headers=admin_headers,
                    json={"new_status": "Deleted"})
    assert r.status_code == 400


def test_investigator_without_access_gets_403(client, inv_headers, sample_case_id):
    r = client.post(f"/api/cases/{sample_case_id}/status", headers=inv_headers,
                    json={"new_status": "Solved"})
    assert r.status_code in (403, 404)


def test_investigator_read_only_cannot_change_status(client, admin_headers, inv_headers, sample_case_id):
    # grant the investigator READ-ONLY access (as an approved access request would)
    r = client.post("/api/admin/access-control", headers=admin_headers,
                    json={"case_id": sample_case_id, "analyst_id": "INV204",
                          "access_level": "Read Only"})
    assert r.status_code == 200, r.text
    r = client.post(f"/api/cases/{sample_case_id}/status", headers=inv_headers,
                    json={"new_status": "Solved"})
    assert r.status_code == 403, "Read-Only investigator must not change case status"


def test_pipeline_preserves_custom_status(client, admin_headers, sample_case_id):
    # set a distinct status, then reprocess, and confirm the pipeline does NOT reset it
    client.post(f"/api/cases/{sample_case_id}/status", headers=admin_headers,
                json={"new_status": "Solved", "comment": "preserve-across-reprocess"})
    r = client.post("/api/admin/processing/start", headers=admin_headers)
    assert r.status_code == 200, r.text
    job = _c._wait_for_job(client, admin_headers, r.json()["job_id"])
    assert job["status"] == "Completed"

    case = client.get(f"/api/cases/{sample_case_id}", headers=admin_headers).json()
    assert case["status"] == "Solved", "pipeline must preserve a customized case status"
    # back to baseline
    client.post(f"/api/cases/{sample_case_id}/status", headers=admin_headers,
                json={"new_status": "Under Investigation"})