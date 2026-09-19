from app.database import SessionLocal
from app import models, ledger


def test_ledger_chain_valid_after_seal(client, admin_headers, processed):
    r = client.get("/api/admin/ledger", headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["label"] == "Immutable Ledger / Blockchain-Ready Adapter"
    assert body["block_count"] >= 1
    assert body["chain_valid"] is True
    assert body["last_block"]


def test_ledger_verify_endpoint(client, admin_headers, processed):
    r = client.post("/api/admin/ledger/verify", headers=admin_headers)
    assert r.status_code == 200
    assert r.json()["valid"] is True


def test_ledger_blocks_sorted_and_chained(client, admin_headers, processed, sample_cdr_id):
    r = client.get("/api/admin/ledger", headers=admin_headers)
    blocks = sorted(r.json()["blocks"], key=lambda b: b["index"])
    assert blocks[0]["index"] == 0
    for i in range(1, len(blocks)):
        assert blocks[i]["prev_hash"] == blocks[i - 1]["hash"], "block linkage broken"


def test_ledger_contains_evidence_hash(client, admin_headers, processed, sample_cdr_id):
    db = SessionLocal()
    try:
        ldb = ledger.HashChainLedger(db)
        ref = ldb.find_record(db, "call_record", sample_cdr_id)
        assert ref is not None, "evidence SHA-256 must be anchored in the ledger"
        block_index, sha256 = ref
        assert block_index >= 1
        assert len(sha256) == 64
    finally:
        db.close()


def test_registry_tampering_still_detected(client, admin_headers, processed, sample_cdr_id):
    """Even if the app-side EvidenceHash registry itself is modified (the strongest attack the
    ledger guards against), verification detects it because the ledger holds the true hash."""
    db = SessionLocal()
    try:
        row = db.query(models.EvidenceHash).filter(
            models.EvidenceHash.evidence_type == "call_record",
            models.EvidenceHash.record_id == sample_cdr_id,
        ).one()
        original = row.sha256
    finally:
        db.close()

    db = SessionLocal()
    try:
        row = db.query(models.EvidenceHash).filter(
            models.EvidenceHash.evidence_type == "call_record",
            models.EvidenceHash.record_id == sample_cdr_id,
        ).one()
        row.sha256 = "f" * 64
        db.commit()
    finally:
        db.close()

    try:
        r = client.post(f"/api/evidence/CDR/{sample_cdr_id}/verify", headers=admin_headers)
        assert r.status_code == 200
        assert r.json()["verified"] is False, "corrupted registry must not pass verification"
    finally:
        db = SessionLocal()
        try:
            row = db.query(models.EvidenceHash).filter(
                models.EvidenceHash.evidence_type == "call_record",
                models.EvidenceHash.record_id == sample_cdr_id,
            ).one()
            row.sha256 = original
            db.commit()
        finally:
            db.close()