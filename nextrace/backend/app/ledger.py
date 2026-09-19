"""
Immutable ledger / blockchain-ready adapter.

Design follows the approved plan: a self-implemented, append-only SHA-256 HASH-CHAINED ledger.
Each block stores (index, prev_hash, timestamp, payload) and its own hash covers the previous
block's hash + payload, so the chain is tamper-evident - altering or reordering any block breaks
every subsequent hash. It is backed by the `ledger_blocks` table AND an append-only mirror file
outside the database (`backend/data/ledger_append_only.jsonl`) for an independent anchor.

What is stored: ONLY SHA-256 hashes and provenance metadata (evidence type/id, case reference,
source file, sealed time). RAW / SENSITIVE evidence never enters the ledger.

This is explicitly an "Immutable Ledger / Blockchain-Ready Adapter", NOT a real blockchain
network (no Ganache/Hardhat/Anvil etc.). A production deployment would swap HashChainLedger for
a real chain (Ethereum / Hyperledger Besu) that implements the same LedgerBackend surface.
"""
import json
import os
from datetime import datetime

from sqlalchemy.orm import Session

from . import models

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # backend/
DATA_DIR = os.path.join(BASE_DIR, "data")
MIRROR_FILE = os.path.join(DATA_DIR, "ledger_append_only.jsonl")

GENESIS_PREV = "0" * 64


class LedgerBackend:
    """Adapter contract a real blockchain network would implement instead of HashChainLedger.

    - append_block(payload: dict) -> block metadata
    - verify_chain()            -> {valid, blocks, broken_at}
    - find_record(type, id)     -> (block_index, sha256) or None
    - summarize()               -> human-facing chain overview
    """

    name = "LedgerBackend"

    def __init__(self, db: Session):
        self.db = db


def _sha256_hex(text: str) -> str:
    import hashlib
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _block_hash(index: int, prev_hash: str, payload: str) -> str:
    return _sha256_hex(f"{index}|{prev_hash}|{payload}")


class HashChainLedger(LedgerBackend):
    """Append-only hash-chained ledger (immutable ledger / blockchain-ready adapter)."""

    name = "HashChainLedger"

    def _ensure_genesis(self):
        if self.db.query(models.LedgerBlock).count() == 0:
            payload_str = json.dumps(
                {"kind": "genesis", "note": "NexTrace immutable ledger (blockchain-ready adapter)",
                 "created_at": datetime.utcnow().isoformat()},
                sort_keys=True, separators=(",", ":"))
            block = models.LedgerBlock(
                index=0, prev_hash=GENESIS_PREV, payload=payload_str,
                hash=_block_hash(0, GENESIS_PREV, payload_str),
            )
            self.db.add(block)
            self.db.commit()
            self._mirror(block)

    def _mirror(self, block: models.LedgerBlock):
        """Best-effort append to the external JSONL mirror. The DB chain is authoritative; a
        failed write here must never break an operation."""
        try:
            os.makedirs(DATA_DIR, exist_ok=True)
            line = json.dumps({
                "index": block.index, "prev_hash": block.prev_hash,
                "timestamp": datetime.utcnow().isoformat(),
                "payload": block.payload, "hash": block.hash,
            }, sort_keys=True)
            with open(MIRROR_FILE, "a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        except OSError:
            pass

    def append_block(self, payload: dict):
        self._ensure_genesis()
        last = self.db.query(models.LedgerBlock).order_by(models.LedgerBlock.index.desc()).first()
        index = (last.index if last else -1) + 1
        prev_hash = last.hash if last else GENESIS_PREV
        payload_str = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        block = models.LedgerBlock(index=index, prev_hash=prev_hash,
                                   payload=payload_str,
                                   hash=_block_hash(index, prev_hash, payload_str))
        self.db.add(block)
        self.db.commit()
        self.db.refresh(block)
        self._mirror(block)
        return {"index": block.index, "hash": block.hash, "prev_hash": block.prev_hash,
                "records": len(payload.get("records", []))}

    def verify_chain(self, db=None):
        session = db or self.db
        blocks = session.query(models.LedgerBlock).order_by(models.LedgerBlock.index).all()
        prev = GENESIS_PREV
        for i, block in enumerate(blocks):
            if block.index != i:
                return {"valid": False, "blocks": len(blocks), "broken_at": block.index,
                        "reason": "block_index_gap"}
            if block.prev_hash != prev:
                return {"valid": False, "blocks": len(blocks), "broken_at": block.index,
                        "reason": "prev_hash_mismatch"}
            recomputed = _block_hash(block.index, block.prev_hash, block.payload)
            if recomputed != block.hash:
                return {"valid": False, "blocks": len(blocks), "broken_at": block.index,
                        "reason": "hash_mismatch"}
            prev = block.hash
        return {"valid": True, "blocks": len(blocks), "broken_at": None, "reason": None}

    def find_record(self, db, evidence_type: str, record_id: str):
        """Latest (block_index, sha256) anchoring this evidence record, or None."""
        session = db or self.db
        blocks = session.query(models.LedgerBlock).order_by(models.LedgerBlock.index).all()
        found = None
        for b in blocks:
            try:
                payload = json.loads(b.payload)
            except (ValueError, TypeError):
                continue
            for entry in payload.get("records", []) or []:
                if entry.get("evidence_type") == evidence_type and str(entry.get("record_id")) == record_id:
                    found = (b.index, entry.get("sha256"))
        return found

    def summarize(self):
        self._ensure_genesis()
        blocks = self.db.query(models.LedgerBlock).order_by(models.LedgerBlock.index).all()
        chain = self.verify_chain()
        return {
            "backend": self.name,
            "label": "Immutable Ledger / Blockchain-Ready Adapter",
            "block_count": len(blocks),
            "chain_valid": chain["valid"],
            "broken_at": chain["broken_at"],
            "last_block": {
                "index": blocks[-1].index, "hash": blocks[-1].hash,
                "prev_hash": blocks[-1].prev_hash,
                "timestamp": blocks[-1].timestamp.isoformat() if blocks[-1].timestamp else None,
                "records_count": len(json.loads(blocks[-1].payload).get("records", []))
                if blocks else 0,
            } if blocks else None,
            "genesis_hash": blocks[0].hash if blocks else None,
            "mirror_file": MIRROR_FILE,
        }


def block_list(db: Session):
    rows = db.query(models.LedgerBlock).order_by(models.LedgerBlock.index.desc()).limit(50).all()
    out = []
    for b in rows:
        payload = json.loads(b.payload)
        records = payload.get("records", []) or []
        out.append({
            "index": b.index, "hash": b.hash, "prev_hash": b.prev_hash,
            "timestamp": b.timestamp.isoformat() if b.timestamp else None,
            "kind": payload.get("kind"), "records_count": len(records),
            "sealed_at": payload.get("sealed_at"),
            "entries": [{"evidence_type": e.get("evidence_type"), "record_id": e.get("record_id"),
                         "sha256": e.get("sha256"), "case_id": e.get("case_id"),
                         "source_file": e.get("source_file")} for e in records[:20]],
        })
    return out