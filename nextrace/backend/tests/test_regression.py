"""Regression: core pre-existing endpoints must keep working after all changes."""


def test_dashboard(client, admin_headers, processed):
    r = client.get("/api/dashboard", headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["total_entities"] > 0
    assert body["total_relationships"] > 0


def test_evidence_repository(client, admin_headers, processed):
    r = client.get("/api/evidence", headers=admin_headers)
    assert r.status_code == 200
    types = {i["evidence_type"] for i in r.json()}
    assert {"CDR", "Financial", "CCTV", "Report"}.issubset(types)


def test_evidence_types_filter(client, admin_headers, processed):
    r = client.get("/api/evidence?evidence_type=CDR", headers=admin_headers)
    assert r.status_code == 200
    assert all(i["evidence_type"] == "CDR" for i in r.json())


def test_graph_and_analytics(client, admin_headers, processed):
    assert client.get("/api/graph", headers=admin_headers).status_code == 200
    assert client.get("/api/graph/analytics", headers=admin_headers).status_code == 200


def test_shortest_path(client, admin_headers, processed):
    graph = client.get("/api/graph", headers=admin_headers).json()
    assert graph["nodes"]
    nids = [n["id"] for n in graph["nodes"]]
    r = client.post("/api/graph/path", headers=admin_headers,
                    json={"source_id": nids[0], "target_id": nids[-1]})
    assert r.status_code == 200
    assert "path" in r.json()


def test_entities_and_profile(client, admin_headers, processed):
    entities = client.get("/api/entities", headers=admin_headers).json()
    assert entities
    eid = entities[0]["id"]
    assert client.get(f"/api/entities/{eid}", headers=admin_headers).status_code == 200


def test_resolution_candidates(client, admin_headers, processed):
    r = client.get("/api/entity-resolution", headers=admin_headers)
    assert r.status_code == 200


def test_timeline(client, admin_headers, processed):
    r = client.get("/api/timeline", headers=admin_headers)
    assert r.status_code == 200


def test_case_messages_thread(client, admin_headers, sample_case_id):
    r = client.post(f"/api/cases/{sample_case_id}/messages", headers=admin_headers,
                    json={"message": "Update: analysing new CDR batch."})
    assert r.status_code == 200
    msgs = client.get(f"/api/cases/{sample_case_id}/messages", headers=admin_headers).json()
    assert any(m["message"].startswith("Update:") for m in msgs)


def test_audit_log_has_integrity_entries(client, admin_headers, processed, sample_cdr_id):
    client.post(f"/api/evidence/CDR/{sample_cdr_id}/verify", headers=admin_headers)
    audit = client.get("/api/admin/audit", headers=admin_headers).json()
    assert any("evidence integrity" in a["action"].lower() for a in audit)


def test_report_generation(client, admin_headers, processed, sample_case_id):
    r = client.post("/api/reports/generate", headers=admin_headers,
                    json={"case_id": sample_case_id,
                          "sections": ["executive_summary", "provenance"]})
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"