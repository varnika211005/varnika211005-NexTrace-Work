import csv
import io
import json
import os
import threading
import time
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import or_

from . import models, schemas, analysis, intelligence, auth, seed, reports, scope
from . import evidence_integrity, ledger, biometrics, backup as backup_mod
from .database import Base, engine, get_db, SessionLocal

Base.metadata.create_all(bind=engine)
with SessionLocal() as _db:
    seed.seed_users(_db)
    ledger.HashChainLedger(_db).summarize()  # ensure genesis block + mirror dir on startup

app = FastAPI(title="NexTrace API", version="0.2.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def log_audit(db, user, action, resource=None, case_id=None, result="Success"):
    db.add(models.AuditLog(user=user.analyst_id, role=user.role, action=action,
                            resource=resource, case_id=case_id, result=result))
    db.commit()


@app.get("/api/health")
def health():
    return {"status": "ok"}


# ===========================================================================
# AUTH
# ===========================================================================
@app.post("/api/auth/login")
def login(body: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.analyst_id == body.analyst_id).first()
    if not user or not auth.verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Invalid Analyst ID or password.")
    # Admin Investigators can always sign in, even if marked Inactive, so an admin is never
    # accidentally locked out of the system. Investigators cannot sign in while Inactive.
    if user.status != "Active" and user.role != "admin_investigator":
        raise HTTPException(403, "This account has been deactivated. Contact an administrator.")
    user.last_active = datetime.utcnow()
    db.commit()
    token = auth.create_token(user)
    log_audit(db, user, "Login")
    return {
        "token": token,
        "user": {"analyst_id": user.analyst_id, "name": user.name, "role": user.role},
    }


@app.get("/api/auth/me")
def me(user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    case_count = db.query(models.CaseAccess).filter(models.CaseAccess.analyst_id == user.analyst_id).count()
    return {
        "analyst_id": user.analyst_id, "name": user.name, "role": user.role,
        "status": user.status, "last_active": user.last_active, "assigned_cases": case_count,
    }


# ===========================================================================
# DATA INGESTION (admin only)
# ===========================================================================
DATASET_CONFIG = {
    "persons": {"model": models.Person, "required": {"id", "name"}, "filename": "persons.csv"},
    "cdr": {"model": models.CallRecord, "required": {"id", "caller_phone", "receiver_phone"}, "filename": "cdr_records.csv"},
    "financial": {"model": models.FinancialRecord, "required": {"id", "sender_account", "receiver_account"}, "filename": "financial_records.csv"},
    "cctv": {"model": models.CCTVSighting, "required": {"id"}, "filename": "cctv_sightings.csv"},
    "reports": {"model": models.CaseReport, "required": {"id"}, "filename": "investigation_reports.csv"},
}


def _row_to_kwargs(model, row: dict):
    columns = {c.name for c in model.__table__.columns}
    kwargs = {}
    for k, v in row.items():
        if k in columns and v not in (None, ""):
            if k == "amount":
                try:
                    v = float(v)
                except ValueError:
                    continue
            if k == "duration_seconds":
                try:
                    v = int(v)
                except ValueError:
                    continue
            if k == "age":
                try:
                    v = int(v)
                except ValueError:
                    continue
            kwargs[k] = v
    return kwargs


@app.post("/api/admin/ingestion/upload/{dataset_type}")
async def upload_dataset(dataset_type: str, file: UploadFile = File(...), mode: str = Form("append"),
                          user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    """Ingests a CSV into the given dataset type.

    mode="append" (default): new records are added, and any record whose id matches one already
    in the database is updated in place - nothing existing is lost. This is what real-world daily
    ingestion needs: today's new call log adds to yesterday's, it doesn't erase it.

    mode="replace": wipes every existing record of this type first, then loads the file fresh -
    for when you genuinely want to start this dataset type over (e.g. correcting a bad import).
    """
    if dataset_type not in DATASET_CONFIG:
        raise HTTPException(400, f"Unknown dataset type '{dataset_type}'.")
    if mode not in ("append", "replace"):
        raise HTTPException(400, "mode must be 'append' or 'replace'.")
    cfg = DATASET_CONFIG[dataset_type]

    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(400, "File is not valid UTF-8 text.")

    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise HTTPException(400, "CSV appears to be empty.")
    columns = {c.strip() for c in reader.fieldnames}
    missing = cfg["required"] - columns
    if missing:
        raise HTTPException(400, f"CSV is missing required column(s): {', '.join(missing)}")

    model = cfg["model"]
    count_before = db.query(model).count()
    if mode == "replace":
        db.query(model).delete()

    new_count, updated_count, skipped = 0, 0, 0
    existing_ids = {row[0] for row in db.query(model.id).all()}
    for row in reader:
        row = {(k.strip() if k else k): (v.strip() if isinstance(v, str) else v)
               for k, v in row.items() if k is not None}
        if not row.get("id"):
            skipped += 1
            continue
        kwargs = _row_to_kwargs(model, row)
        try:
            db.merge(model(**kwargs))
            if kwargs.get("id") in existing_ids:
                updated_count += 1
            else:
                new_count += 1
                existing_ids.add(kwargs.get("id"))
        except Exception:
            skipped += 1
    db.commit()
    count_after = db.query(model).count()

    existing_file = db.query(models.IngestedFile).filter(models.IngestedFile.dataset_type == dataset_type).first()
    if existing_file:
        existing_file.filename = file.filename
        existing_file.uploaded_by = user.analyst_id
        existing_file.uploaded_at = datetime.utcnow()
        existing_file.records_count = count_after
        existing_file.status = "Uploaded"
    else:
        db.add(models.IngestedFile(dataset_type=dataset_type, filename=file.filename, uploaded_by=user.analyst_id,
                                    records_count=count_after, status="Uploaded"))
    db.commit()
    log_audit(db, user, "Uploaded dataset", resource=f"{dataset_type}:{file.filename} ({mode})")

    # Seal the newly ingested raw records with SHA-256 + anchor into the immutable ledger.
    # Failures are isolated: an upload must never fail because sealing hiccuped.
    try:
        seal = evidence_integrity.seal_evidence(db, user.analyst_id)
    except Exception:
        seal = {"hashed": 0, "unchanged": 0, "new": 0, "changed": 0}

    if mode == "replace":
        message = f"Replaced dataset: {count_after} record(s) now on file from {file.filename}."
    else:
        message = (f"{new_count} new record(s) added, {updated_count} existing record(s) updated "
                    f"from {file.filename}. Total {dataset_type} records: {count_before} → {count_after}.")
    return {
        "message": message, "mode": mode,
        "records_new": new_count, "records_updated": updated_count, "records_skipped": skipped,
        "total_before": count_before, "total_after": count_after,
        "sealed_hashes": seal.get("hashed", 0),
        # kept for compatibility with older frontend builds
        "records_inserted": new_count + updated_count,
    }


@app.get("/api/admin/ingestion/files")
def ingestion_files(user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    counts = {
        "persons": db.query(models.Person).filter(models.Person.is_unresolved == False).count(),
        "cdr": db.query(models.CallRecord).count(),
        "financial": db.query(models.FinancialRecord).count(),
        "cctv": db.query(models.CCTVSighting).count(),
        "reports": db.query(models.CaseReport).count(),
    }
    files = {f.dataset_type: f for f in db.query(models.IngestedFile).all()}
    out = []
    for dtype, cfg in DATASET_CONFIG.items():
        f = files.get(dtype)
        out.append({
            "dataset_type": dtype, "expected_filename": cfg["filename"],
            "filename": f.filename if f else None,
            "uploaded_by": f.uploaded_by if f else None,
            "uploaded_at": f.uploaded_at if f else None,
            "records_count": counts[dtype],
            "status": f.status if f else "Not Uploaded",
        })
    return out


@app.delete("/api/admin/ingestion/{dataset_type}")
def delete_dataset(dataset_type: str, user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    """Completely removes every record of this dataset type from the database (not just the file).

    Because relationships are built by cross-referencing ALL evidence sources together, deleting
    any one source invalidates the previously-computed relationship graph - so relationships (and,
    if the persons dataset itself is deleted, entity-resolution candidates) are cleared too. Run
    Processing again afterward to rebuild the graph from whatever data remains.
    """
    if dataset_type not in DATASET_CONFIG:
        raise HTTPException(400, f"Unknown dataset type '{dataset_type}'.")

    model = DATASET_CONFIG[dataset_type]["model"]
    deleted_count = db.query(model).count()
    if dataset_type == "persons":
        deleted_count = db.query(model).filter(models.Person.is_unresolved == False).count()
        db.query(models.Person).filter(models.Person.is_unresolved == False).delete()
        db.query(models.Person).filter(models.Person.is_unresolved == True).delete()  # stale placeholders too
        db.query(models.EntityResolutionCandidate).delete()
        db.query(models.CaseFile).delete()
        db.query(models.CaseAccess).delete()
    else:
        db.query(model).delete()

    db.query(models.Relationship).delete()  # always stale once any source changes
    db.query(models.IngestedFile).filter(models.IngestedFile.dataset_type == dataset_type).delete()

    # Clear integrity/tamper/status references for the removed evidence. Evidence hashes,
    # demo-tamper snapshots and security events that referenced deleted records are moot, and
    # case status history for cases with no remaining subjects is dropped. The immutable
    # ledger is deliberately left untouched (append-only history).
    evidence_key = {"persons": "person", "cdr": "call_record", "financial": "financial_record",
                    "cctv": "cctv_sighting", "reports": "case_report"}[dataset_type]
    db.query(models.EvidenceHash).filter(models.EvidenceHash.evidence_type == evidence_key).delete()
    db.query(models.DemoTamperRecord).filter(models.DemoTamperRecord.evidence_type == evidence_key).delete()
    db.query(models.SecurityEvent).filter(models.SecurityEvent.evidence_type == evidence_key).delete()
    if dataset_type == "persons":
        db.query(models.BiometricEvidence).delete()
        remaining_case_ids = {p.case_id for p in db.query(models.Person)
                              .filter(models.Person.is_unresolved == False).all() if p.case_id}
        if remaining_case_ids:
            db.query(models.CaseStatusHistory).filter(
                ~models.CaseStatusHistory.case_id.in_(remaining_case_ids)).delete(synchronize_session=False)
        else:
            db.query(models.CaseStatusHistory).delete()
    db.commit()

    log_audit(db, user, "Deleted dataset", resource=f"{dataset_type} ({deleted_count} records)")
    return {
        "message": f"{deleted_count} record(s) permanently deleted from {dataset_type}. "
                   f"Relationships were cleared and need to be rebuilt — run Processing again.",
        "deleted_count": deleted_count,
    }


CASE_STATUSES = ["Under Investigation", "Solved", "Unsolved or Closed"]

STAGE_NAMES = [
    "Data Validation", "Data Cleaning", "Entity Extraction (NLP/CV)",
    "Entity Resolution", "Relationship & Graph Construction",
    "Graph Analytics", "Pattern Analysis",
    "Evidence Integrity (SHA-256 Seal)",
]


def _run_pipeline(job_id: int, started_by: str):
    db = SessionLocal()
    try:
        job = db.query(models.ProcessingJob).get(job_id)
        stages = json.loads(job.stages_json)

        def update_stage(idx, status, records=None):
            stages[idx]["status"] = status
            if status == "Running":
                stages[idx]["started_at"] = datetime.utcnow().isoformat()
            if status == "Completed":
                stages[idx]["finished_at"] = datetime.utcnow().isoformat()
                if records is not None:
                    stages[idx]["records"] = records
            job.stages_json = json.dumps(stages)
            job.current_stage = stages[idx]["name"]
            db.commit()

        # Stage 0: validation
        update_stage(0, "Running")
        time.sleep(0.4)
        n_persons = db.query(models.Person).filter(models.Person.is_unresolved == False).count()
        n_cdr = db.query(models.CallRecord).count()
        n_fin = db.query(models.FinancialRecord).count()
        n_cctv = db.query(models.CCTVSighting).count()
        n_rpt = db.query(models.CaseReport).count()
        update_stage(0, "Completed", n_persons + n_cdr + n_fin + n_cctv + n_rpt)

        # Stage 1: cleaning
        update_stage(1, "Running")
        time.sleep(0.4)
        update_stage(1, "Completed", n_persons)

        # Stage 2: entity extraction (name mentions in reports + cctv resolution happens inside run_full_analysis,
        # but we report indicative counts here)
        update_stage(2, "Running")
        time.sleep(0.5)
        update_stage(2, "Completed", n_rpt + n_cctv)

        # Stage 3: entity resolution candidates
        update_stage(3, "Running")
        time.sleep(0.4)
        candidates = intelligence.generate_resolution_candidates(db)
        existing_pairs = {(c.person_a_id, c.person_b_id) for c in db.query(models.EntityResolutionCandidate).all()}
        new_count = 0
        for c in candidates:
            key = (c["person_a_id"], c["person_b_id"])
            if key not in existing_pairs:
                db.add(models.EntityResolutionCandidate(
                    person_a_id=c["person_a_id"], person_b_id=c["person_b_id"],
                    similarity=c["similarity"], reasons=json.dumps(c["reasons"]),
                ))
                new_count += 1
        db.commit()
        update_stage(3, "Completed", new_count)

        # Stage 4: relationship & graph construction (the core pipeline)
        update_stage(4, "Running")
        time.sleep(0.5)
        rel_count, unresolved_count = analysis.run_full_analysis(db)
        update_stage(4, "Completed", rel_count)

        # Stage 5: graph analytics
        update_stage(5, "Running")
        time.sleep(0.4)
        G = analysis.build_graph(db)
        communities = len(set(analysis.graph_communities(G).values())) if G.number_of_nodes() else 0
        update_stage(5, "Completed", communities)

        # Stage 6: pattern analysis
        update_stage(6, "Running")
        time.sleep(0.4)
        indicators = intelligence.generate_intelligence_indicators(db, G)
        update_stage(6, "Completed", len(indicators))

        # sync derived cases table - UPSERT preserving existing case metadata (status, opened
        # date, and therefore the case-status audit trail) across reprocessing runs.
        case_ids = {p.case_id for p in db.query(models.Person).filter(models.Person.is_unresolved == False).all() if p.case_id}
        existing_cases = {c.case_id: c for c in db.query(models.CaseFile).all()}
        for cid in case_ids:
            report = db.query(models.CaseReport).filter(models.CaseReport.case_id == cid).order_by(models.CaseReport.date_filed).first()
            case = existing_cases.get(cid)
            if case:
                case.title = report.title if report else f"Investigation {cid}"
                if not case.opened_date:
                    case.opened_date = report.date_filed if report else None
            else:
                db.add(models.CaseFile(case_id=cid, title=report.title if report else f"Investigation {cid}",
                                        status="Under Investigation", opened_date=report.date_filed if report else None))
        db.commit()

        # Stage 7: evidence integrity - seal every raw record with SHA-256 and anchor it into
        # the immutable ledger (blockchain-ready adapter).
        update_stage(7, "Running")
        time.sleep(0.3)
        seal_counts = evidence_integrity.seal_evidence(db, started_by)
        update_stage(7, "Completed", seal_counts["hashed"] + seal_counts["unchanged"])

        job.status = "Completed"
        job.finished_at = datetime.utcnow()
        job.current_stage = None
        db.commit()
    except Exception as exc:
        job = db.query(models.ProcessingJob).get(job_id)
        job.status = "Failed"
        job.finished_at = datetime.utcnow()
        db.commit()
        raise exc
    finally:
        db.close()


@app.post("/api/admin/processing/start")
def start_processing(user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    if db.query(models.Person).count() == 0:
        raise HTTPException(400, "No data ingested yet. Upload at least the persons dataset first.")
    stages = [{"name": n, "status": "Queued", "records": None, "started_at": None, "finished_at": None} for n in STAGE_NAMES]
    job = models.ProcessingJob(status="Running", stages_json=json.dumps(stages), started_by=user.analyst_id)
    db.add(job)
    db.commit()
    db.refresh(job)
    log_audit(db, user, "Started processing pipeline", resource=f"job:{job.id}")
    thread = threading.Thread(target=_run_pipeline, args=(job.id, user.analyst_id), daemon=True)
    thread.start()
    return {"job_id": job.id, "message": "Processing started."}


@app.get("/api/admin/processing/jobs")
def list_jobs(user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    jobs = db.query(models.ProcessingJob).order_by(models.ProcessingJob.id.desc()).limit(10).all()
    return [{
        "id": j.id, "status": j.status, "current_stage": j.current_stage,
        "stages": json.loads(j.stages_json) if j.stages_json else [],
        "started_at": j.started_at, "finished_at": j.finished_at, "started_by": j.started_by,
    } for j in jobs]


@app.get("/api/admin/processing/jobs/{job_id}")
def get_job(job_id: int, user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    j = db.query(models.ProcessingJob).get(job_id)
    if not j:
        raise HTTPException(404, "Job not found.")
    return {
        "id": j.id, "status": j.status, "current_stage": j.current_stage,
        "stages": json.loads(j.stages_json) if j.stages_json else [],
        "started_at": j.started_at, "finished_at": j.finished_at, "started_by": j.started_by,
    }


# ===========================================================================
# ENTITY RESOLUTION (view = anyone signed in, act = admin only)
# ===========================================================================
@app.get("/api/entity-resolution")
def list_resolution_candidates(user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    sc = scope.get_scope(db, user)
    rows = db.query(models.EntityResolutionCandidate).order_by(models.EntityResolutionCandidate.similarity.desc()).all()
    if not sc.is_admin:
        rows = [r for r in rows if r.person_a_id in sc.primary_ids or r.person_b_id in sc.primary_ids]
    out = []
    for r in rows:
        a = db.query(models.Person).get(r.person_a_id)
        b = db.query(models.Person).get(r.person_b_id)
        out.append({
            "id": r.id, "person_a": {"id": r.person_a_id, "name": a.name if a else "?"},
            "person_b": {"id": r.person_b_id, "name": b.name if b else "?"},
            "similarity": r.similarity, "reasons": json.loads(r.reasons),
            "status": r.status, "reviewed_by": r.reviewed_by, "reviewed_at": r.reviewed_at,
        })
    return out


@app.post("/api/admin/entity-resolution/{cand_id}/confirm")
def confirm_match(cand_id: int, user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    c = db.query(models.EntityResolutionCandidate).get(cand_id)
    if not c:
        raise HTTPException(404, "Candidate not found.")
    c.status = "Confirmed"
    c.reviewed_by = user.analyst_id
    c.reviewed_at = datetime.utcnow()
    db.commit()
    log_audit(db, user, "Confirmed entity match", resource=f"{c.person_a_id}<->{c.person_b_id}")
    return {"message": "Match confirmed.", "status": c.status}


@app.post("/api/admin/entity-resolution/{cand_id}/reject")
def reject_match(cand_id: int, user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    c = db.query(models.EntityResolutionCandidate).get(cand_id)
    if not c:
        raise HTTPException(404, "Candidate not found.")
    c.status = "Rejected"
    c.reviewed_by = user.analyst_id
    c.reviewed_at = datetime.utcnow()
    db.commit()
    log_audit(db, user, "Rejected entity match", resource=f"{c.person_a_id}<->{c.person_b_id}")
    return {"message": "Match rejected.", "status": c.status}


# ===========================================================================
# ENTITIES
# ===========================================================================
def _pending_ids(db):
    rows = db.query(models.EntityResolutionCandidate).filter(models.EntityResolutionCandidate.status == "Pending").all()
    ids = set()
    for r in rows:
        ids.add(r.person_a_id)
        ids.add(r.person_b_id)
    return ids


@app.get("/api/entities")
def list_entities(user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db),
                   q: Optional[str] = None, crime_type: Optional[str] = None, case_id: Optional[str] = None,
                   include_unresolved: bool = False):
    sc = scope.get_scope(db, user)
    query = db.query(models.Person)
    if not include_unresolved:
        query = query.filter(models.Person.is_unresolved == False)
    if crime_type:
        query = query.filter(models.Person.crime_type == crime_type)
    if case_id:
        query = query.filter(models.Person.case_id == case_id)
    if q:
        like = f"%{q}%"
        query = query.filter(or_(models.Person.name.ilike(like), models.Person.aliases.ilike(like),
                                  models.Person.phone.ilike(like), models.Person.case_id.ilike(like)))
    persons = query.all()
    if not sc.is_admin:
        persons = [p for p in persons if p.id in sc.visible_ids]
    pending = _pending_ids(db)

    results = []
    for p in persons:
        access = sc.person_access(p.id)
        if access == "bridge":
            # Bridge person: only the connections tying back into the investigator's own
            # case(s) are visible - not their full relationship set.
            bridge_rels = scope.bridge_relationships_for(db, sc, p.id)
            results.append({
                "id": p.id, "name": p.name, "crime_type": None, "city": None, "case_id": None,
                "is_unresolved": p.is_unresolved, "connection_count": len(bridge_rels),
                "max_confidence": max((r.confidence for r in bridge_rels), default=0.0),
                "reliability": None, "access_level": "bridge",
            })
            continue
        rels = intelligence._relationships_for(db, p.id)
        if not sc.is_admin:
            rels = [r for r in rels if sc.person_access(r["target_id"]) != "none"]
        reliability = intelligence.compute_reliability(db, p, rels, pending)
        results.append({
            "id": p.id, "name": p.name, "crime_type": p.crime_type, "city": p.city, "case_id": p.case_id,
            "is_unresolved": p.is_unresolved, "connection_count": len(rels),
            "max_confidence": max((r["confidence"] for r in rels), default=0.0),
            "reliability": reliability["overall"], "access_level": "full",
        })
    results.sort(key=lambda r: r["connection_count"], reverse=True)
    return results


@app.get("/api/entities/{entity_id}")
def get_entity(entity_id: str, user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    p = db.query(models.Person).get(entity_id)
    if not p:
        raise HTTPException(404, "Entity not found.")

    sc = scope.get_scope(db, user)
    access = sc.person_access(entity_id)
    if access == "none":
        raise HTTPException(403, "You don't have access to this subject. You can request access "
                                  "from an Admin Investigator.")

    if access == "bridge":
        bridge_rels = scope.bridge_relationships_for(db, sc, entity_id)
        rels = []
        for r in bridge_rels:
            other_id = r.target_id if r.source_id == entity_id else r.source_id
            other = db.query(models.Person).get(other_id)
            rels.append({
                "id": r.id, "source_id": entity_id, "target_id": other_id,
                "target_name": other.name if other else "Unknown",
                "target_is_unresolved": other.is_unresolved if other else True,
                "confidence": r.confidence, "confidence_band": analysis.confidence_band(r.confidence),
                "primary_type": r.primary_type, "evidence": json.loads(r.evidence),
            })
        return {
            "entity": {
                "id": p.id, "name": p.name, "age": None, "gender": None, "aliases": None,
                "phone": None, "alt_phone": None, "address": None, "city": None,
                "vehicle_number": None, "organization": None, "case_id": None,
                "crime_type": None, "status": None, "first_seen": None, "last_seen": None,
                "account_number": None, "notes": None, "is_unresolved": p.is_unresolved,
                "node_subtype": analysis.node_subtype(p),
            },
            "summary": f"{p.name} belongs to a case outside your current assignment. Only the "
                       f"connection(s) linking them to your case are shown below. Request access "
                       f"from an Admin Investigator to see their full profile.",
            "reliability": {"overall": 0, "components": {}},
            "degree_centrality_rank": None, "is_bridge_entity": False,
            "relationships": rels, "evidence": [], "timeline": [],
            "access_level": "bridge",
        }

    rels = intelligence._relationships_for(db, entity_id)
    if not sc.is_admin:
        rels = [r for r in rels if sc.person_access(r["target_id"]) != "none"]
    G = analysis.build_graph(db)
    bridges = analysis.bridge_entities(G)
    pending = _pending_ids(db)
    summary = intelligence.generate_entity_summary(p, rels, G)
    reliability = intelligence.compute_reliability(db, p, rels, pending)

    degree_rank = None
    if G.number_of_nodes() > 0:
        degrees = sorted(G.degree, key=lambda kv: kv[1], reverse=True)
        ids_ranked = [d[0] for d in degrees]
        if entity_id in ids_ranked:
            degree_rank = ids_ranked.index(entity_id) + 1

    # Evidence & timeline: gather every raw record that mentions/resolves to this person
    evidence_records = []
    timeline = []
    for call in db.query(models.CallRecord).all():
        if entity_id.startswith("PHONE-") and entity_id == f"PHONE-{call.caller_phone}" or entity_id == f"PHONE-{call.receiver_phone}":
            pass
        if (p.phone and p.phone in (call.caller_phone, call.receiver_phone)) or \
           (p.alt_phone and p.alt_phone in (call.caller_phone, call.receiver_phone)) or \
           (entity_id == f"PHONE-{call.caller_phone}" or entity_id == f"PHONE-{call.receiver_phone}"):
            evidence_records.append({"type": "Call Record", "id": call.id, "timestamp": call.timestamp,
                                      "detail": f"{call.caller_phone} -> {call.receiver_phone} ({call.duration_seconds}s, {call.tower_location})"})
            timeline.append({"timestamp": call.timestamp, "type": "CDR Event", "description": f"Call/SMS: {call.caller_phone} -> {call.receiver_phone}", "source": "cdr_records.csv", "id": call.id})
    for tx in db.query(models.FinancialRecord).all():
        if (p.account_number and p.account_number in (tx.sender_account, tx.receiver_account)) or \
           (entity_id == f"ACCOUNT-{tx.sender_account}" or entity_id == f"ACCOUNT-{tx.receiver_account}"):
            evidence_records.append({"type": "Financial Record", "id": tx.id, "timestamp": tx.timestamp,
                                      "detail": f"₹{tx.amount:,.0f} {tx.sender_account} -> {tx.receiver_account} ({tx.transaction_type})"})
            timeline.append({"timestamp": tx.timestamp, "type": "Financial Event", "description": f"₹{tx.amount:,.0f} transferred {tx.sender_account} -> {tx.receiver_account}", "source": "financial_records.csv", "id": tx.id})
    name_tokens = [t.strip().lower() for t in ([p.name] + (p.aliases.split("|") if p.aliases else []))]
    for s in db.query(models.CCTVSighting).all():
        matches = (p.vehicle_number and s.vehicle_number == p.vehicle_number) or \
                   (s.name_detected and s.name_detected.strip().lower() in name_tokens) or \
                   (entity_id == f"VEHICLE-{s.vehicle_number}")
        if matches:
            evidence_records.append({"type": "CCTV Sighting", "id": s.id, "timestamp": s.timestamp,
                                      "detail": f"{s.location} - {s.description}"})
            timeline.append({"timestamp": s.timestamp, "type": "CCTV Observation", "description": f"Observed at {s.location}", "source": "cctv_sightings.csv", "id": s.id})
    for r in db.query(models.CaseReport).all():
        if r.narrative_text and any(tok in r.narrative_text.lower() for tok in name_tokens if len(tok) >= 3):
            evidence_records.append({"type": "Investigation Report", "id": r.id, "timestamp": r.date_filed,
                                      "detail": f"{r.title} ({r.case_id})"})
            timeline.append({"timestamp": r.date_filed, "type": "Report Filed", "description": r.title, "source": "investigation_reports.csv", "id": r.id})
    timeline.sort(key=lambda e: e["timestamp"] or "")

    return {
        "entity": {
            "id": p.id, "name": p.name, "age": p.age, "gender": p.gender, "aliases": p.aliases,
            "phone": p.phone, "alt_phone": p.alt_phone, "address": p.address, "city": p.city,
            "vehicle_number": p.vehicle_number, "organization": p.organization, "case_id": p.case_id,
            "crime_type": p.crime_type, "status": p.status, "first_seen": p.first_seen, "last_seen": p.last_seen,
            "account_number": p.account_number, "notes": p.notes, "is_unresolved": p.is_unresolved,
            "node_subtype": analysis.node_subtype(p),
        },
        "summary": summary, "reliability": reliability,
        "degree_centrality_rank": degree_rank, "is_bridge_entity": entity_id in bridges,
        "relationships": rels, "evidence": evidence_records, "timeline": timeline,
        "access_level": "full",
    }


@app.delete("/api/admin/entities/{entity_id}")
def delete_entity(entity_id: str, user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    """Permanently deletes a single subject record and everything that directly depends on it.

    Raw evidence rows (calls, transactions, sightings, reports) that reference this person's old
    phone/account/vehicle are NOT deleted, since they're independent source records - if you run
    Processing again afterward, that evidence will simply resolve to a new "Unresolved" placeholder
    instead of this person, which is the correct behavior (the evidence still exists; the identity
    match to a named subject does not).
    """
    p = db.query(models.Person).get(entity_id)
    if not p:
        raise HTTPException(404, "Entity not found.")

    name = p.name
    rel_count = db.query(models.Relationship).filter(
        or_(models.Relationship.source_id == entity_id, models.Relationship.target_id == entity_id)
    ).delete(synchronize_session=False)
    db.query(models.EntityResolutionCandidate).filter(
        or_(models.EntityResolutionCandidate.person_a_id == entity_id, models.EntityResolutionCandidate.person_b_id == entity_id)
    ).delete(synchronize_session=False)
    db.query(models.EvidenceHash).filter(models.EvidenceHash.evidence_type == "person",
                                         models.EvidenceHash.record_id == entity_id).delete()
    db.query(models.DemoTamperRecord).filter(models.DemoTamperRecord.evidence_type == "person",
                                             models.DemoTamperRecord.record_id == entity_id).delete()
    db.query(models.SecurityEvent).filter(models.SecurityEvent.evidence_type == "person",
                                          models.SecurityEvent.record_id == entity_id).delete()
    db.query(models.BiometricEvidence).filter(models.BiometricEvidence.person_id == entity_id).delete()
    db.delete(p)
    db.commit()

    log_audit(db, user, "Deleted entity", resource=f"{entity_id} ({name})")
    return {"message": f"{name} ({entity_id}) permanently deleted, along with {rel_count} relationship(s) involving them."}


# ===========================================================================
# GRAPH
# ===========================================================================
@app.get("/api/graph")
def get_graph(user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db),
              min_confidence: float = 0, categories: Optional[str] = None):
    cat_filter = set(categories.split(",")) if categories else None
    sc = scope.get_scope(db, user)
    persons = db.query(models.Person).all()
    if not sc.is_admin:
        persons = [p for p in persons if p.id in sc.visible_ids]
    G = analysis.build_graph(db)
    communities = analysis.graph_communities(G)

    nodes = []
    for p in persons:
        degree = G.degree(p.id) if p.id in G else 0
        is_bridge = (not sc.is_admin) and sc.person_access(p.id) == "bridge"
        nodes.append({
            "id": p.id, "name": p.name,
            "crime_type": None if is_bridge else p.crime_type,
            "case_id": None if is_bridge else p.case_id,
            "subtype": analysis.node_subtype(p), "degree": degree,
            "community": communities.get(p.id, -1), "isolated": degree == 0,
            "access_level": "bridge" if is_bridge else "full",
        })

    edges = []
    for r in scope.visible_relationship_query(db, sc):
        if r.confidence < min_confidence:
            continue
        evidence = json.loads(r.evidence)
        if cat_filter and not any(e["category"] in cat_filter for e in evidence):
            continue
        edges.append({
            "source": r.source_id, "target": r.target_id, "confidence": r.confidence,
            "confidence_band": analysis.confidence_band(r.confidence),
            "primary_type": r.primary_type, "evidence": evidence,
        })
    return {"nodes": nodes, "edges": edges}


@app.get("/api/graph/analytics")
def graph_analytics(user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    sc = scope.get_scope(db, user)
    persons = {p.id: p for p in db.query(models.Person).all()}
    G = scope.build_visible_graph(db, sc)
    if G.number_of_nodes() == 0:
        return {"nodes": 0, "relationships": 0, "communities": 0, "density": 0, "avg_degree": 0,
                "central_entities": [], "bridge_entities": []}

    density = round(nx_density(G), 3)
    avg_degree = round(sum(dict(G.degree()).values()) / G.number_of_nodes(), 2)
    degree_centrality = sorted(G.degree, key=lambda kv: kv[1], reverse=True)[:5]
    central = [{"id": nid, "name": persons[nid].name if nid in persons else nid, "degree": deg}
               for nid, deg in degree_centrality if deg > 0]
    bridges = analysis.bridge_entities(G, top_n=5)
    bridge_list = [{"id": b, "name": persons[b].name if b in persons else b} for b in bridges]

    return {
        "nodes": G.number_of_nodes(), "relationships": G.number_of_edges(),
        "communities": len(set(analysis.graph_communities(G).values())),
        "density": density, "avg_degree": avg_degree,
        "central_entities": central, "bridge_entities": bridge_list,
    }


def nx_density(G):
    import networkx as nx
    return nx.density(G)


@app.post("/api/graph/path")
def shortest_path(body: schemas.PathRequest, user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    import networkx as nx
    sc = scope.get_scope(db, user)
    G = scope.build_visible_graph(db, sc)
    if body.source_id not in G or body.target_id not in G:
        raise HTTPException(404, "One or both entities not found in the graph.")
    try:
        path = nx.shortest_path(G, body.source_id, body.target_id)
    except nx.NetworkXNoPath:
        return {"path": None, "message": "No path found between these entities."}
    persons = {p.id: p for p in db.query(models.Person).all()}
    hops = []
    for i in range(len(path) - 1):
        edge = G.get_edge_data(path[i], path[i + 1])
        hops.append({
            "from": path[i], "to": path[i + 1],
            "from_name": persons[path[i]].name if path[i] in persons else path[i],
            "to_name": persons[path[i + 1]].name if path[i + 1] in persons else path[i + 1],
            "confidence": edge["confidence"], "primary_type": edge["primary_type"],
        })
    return {"path": path, "hops": hops, "hop_count": len(path) - 1}


# ===========================================================================
# TIMELINE (global, filterable)
# ===========================================================================
@app.get("/api/timeline")
def timeline(user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db),
             case_id: Optional[str] = None, event_type: Optional[str] = None):
    sc = scope.get_scope(db, user)
    if case_id and not sc.can_see_case(case_id):
        raise HTTPException(403, "You don't have access to this case.")

    call_ids, financial_ids, cctv_ids, report_ids = scope.visible_evidence_ids(db, sc)

    events = []
    persons = db.query(models.Person).filter(models.Person.is_unresolved == False)
    if case_id:
        persons = persons.filter(models.Person.case_id == case_id)
    elif not sc.is_admin:
        persons = persons.filter(models.Person.case_id.in_(sc.case_ids)) if sc.case_ids else persons.filter(False)
    person_ids = {p.id for p in persons.all()}
    phones = {p.phone for p in persons.all() if p.phone} | {p.alt_phone for p in persons.all() if p.alt_phone}
    accounts = {p.account_number for p in persons.all() if p.account_number}

    for call in db.query(models.CallRecord).all():
        if call_ids is not None and call.id not in call_ids:
            continue
        if case_id and call.caller_phone not in phones and call.receiver_phone not in phones:
            continue
        events.append({"timestamp": call.timestamp, "type": "CDR Event", "id": call.id,
                        "description": f"{('SMS' if (call.call_type or '').lower()=='sms' else 'Call')}: {call.caller_phone} -> {call.receiver_phone}",
                        "source": "cdr_records.csv"})
    for tx in db.query(models.FinancialRecord).all():
        if financial_ids is not None and tx.id not in financial_ids:
            continue
        if case_id and tx.sender_account not in accounts and tx.receiver_account not in accounts:
            continue
        events.append({"timestamp": tx.timestamp, "type": "Financial Event", "id": tx.id,
                        "description": f"₹{tx.amount:,.0f} transferred {tx.sender_account} -> {tx.receiver_account}",
                        "source": "financial_records.csv"})
    for s in db.query(models.CCTVSighting).all():
        if cctv_ids is not None and s.id not in cctv_ids:
            continue
        events.append({"timestamp": s.timestamp, "type": "CCTV Observation", "id": s.id,
                        "description": f"{s.location}: {s.description}", "source": "cctv_sightings.csv"})
    for r in db.query(models.CaseReport).all():
        if report_ids is not None and r.id not in report_ids:
            continue
        if case_id and r.case_id != case_id:
            continue
        events.append({"timestamp": r.date_filed, "type": "Report Filed", "id": r.id,
                        "description": f"{r.title} ({r.case_id})", "source": "investigation_reports.csv"})

    if event_type:
        events = [e for e in events if e["type"] == event_type]
    events.sort(key=lambda e: e["timestamp"] or "")
    return events


# ===========================================================================
# EVIDENCE REPOSITORY
# ===========================================================================
@app.get("/api/evidence")
def evidence_repository(user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db),
                         evidence_type: Optional[str] = None, q: Optional[str] = None):
    sc = scope.get_scope(db, user)
    call_ids, financial_ids, cctv_ids, report_ids = scope.visible_evidence_ids(db, sc)

    items = []
    for call in db.query(models.CallRecord).all():
        if call_ids is not None and call.id not in call_ids:
            continue
        items.append({"evidence_type": "CDR", "id": call.id, "timestamp": call.timestamp,
                       "summary": f"{call.caller_phone} -> {call.receiver_phone} ({call.duration_seconds}s)",
                       "source_file": "cdr_records.csv"})
    for tx in db.query(models.FinancialRecord).all():
        if financial_ids is not None and tx.id not in financial_ids:
            continue
        items.append({"evidence_type": "Financial", "id": tx.id, "timestamp": tx.timestamp,
                       "summary": f"₹{tx.amount:,.0f} {tx.sender_account} -> {tx.receiver_account}",
                       "source_file": "financial_records.csv"})
    for s in db.query(models.CCTVSighting).all():
        if cctv_ids is not None and s.id not in cctv_ids:
            continue
        items.append({"evidence_type": "CCTV", "id": s.id, "timestamp": s.timestamp,
                       "summary": f"{s.location}: {s.description}", "source_file": "cctv_sightings.csv"})
    for r in db.query(models.CaseReport).all():
        if report_ids is not None and r.id not in report_ids:
            continue
        items.append({"evidence_type": "Report", "id": r.id, "timestamp": r.date_filed,
                       "summary": f"{r.title} ({r.case_id})", "source_file": "investigation_reports.csv"})
    for be in db.query(models.BiometricEvidence).all():
        if not sc.is_admin and not (be.case_id in sc.case_ids or be.person_id in sc.primary_ids):
            continue
        items.append({"evidence_type": "Biometric", "id": str(be.id), "timestamp": be.captured_at,
                       "summary": f"{be.modality.capitalize()} sample · {be.person_name or be.person_id or 'Unlinked'} · {be.location or '—'}",
                       "source_file": be.source_file or "biometric_reference.csv"})
    if evidence_type:
        items = [i for i in items if i["evidence_type"] == evidence_type]
    if q:
        ql = q.lower()
        items = [i for i in items if ql in i["summary"].lower() or ql in i["id"].lower()]
    items.sort(key=lambda i: i["timestamp"] or "", reverse=True)
    return items


@app.get("/api/evidence/{evidence_type}/{record_id}")
def evidence_detail(evidence_type: str, record_id: str, user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    key = evidence_integrity.normalize_evidence_type(evidence_type)
    if not key:
        raise HTTPException(400, "Unknown evidence type.")
    model = evidence_integrity.EVIDENCE_TYPES[key][1]
    row = db.query(model).get(record_id)
    if not row:
        raise HTTPException(404, "Evidence record not found.")

    sc = scope.get_scope(db, user)
    if not sc.is_admin:
        if key == "biometric":
            if not (row.case_id in sc.case_ids or row.person_id in sc.primary_ids):
                raise HTTPException(403, "You don't have access to this evidence record.")
        else:
            call_ids, financial_ids, cctv_ids, report_ids = scope.visible_evidence_ids(db, sc)
            id_set = {"call_record": call_ids, "financial_record": financial_ids,
                      "cctv_sighting": cctv_ids, "case_report": report_ids}[key]
            if record_id not in id_set:
                raise HTTPException(403, "You don't have access to this evidence record.")

    result = {c.name: getattr(row, c.name) for c in row.__table__.columns}

    contributes_to = []
    for rel in db.query(models.Relationship).all():
        if not sc.is_admin and not (rel.source_id in sc.primary_ids or rel.target_id in sc.primary_ids):
            continue
        for e in json.loads(rel.evidence):
            if record_id in (e.get("record_ids") or []) or record_id == str(e.get("record_id") or ""):
                a = db.query(models.Person).get(rel.source_id)
                b = db.query(models.Person).get(rel.target_id)
                contributes_to.append({"relationship_id": rel.id, "source_name": a.name if a else rel.source_id,
                                        "target_name": b.name if b else rel.target_id, "confidence": rel.confidence})
    integrity = evidence_integrity.integrity_summary(db, key, record_id)
    return {"record": result, "contributes_to_relationships": contributes_to,
            "integrity": integrity,
            "biometric_match_available": False if key == "biometric" else None}


@app.post("/api/evidence/{evidence_type}/{record_id}/verify")
def verify_evidence(evidence_type: str, record_id: str,
                    user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    """Cryptographically re-verify a single evidence record: recompute its SHA-256 from the
    current DB row and compare against the recorded hash AND the immutable ledger."""
    key = evidence_integrity.normalize_evidence_type(evidence_type)
    if not key:
        raise HTTPException(400, "Unknown evidence type.")
    model = {"call_record": models.CallRecord, "financial_record": models.FinancialRecord,
             "cctv_sighting": models.CCTVSighting, "case_report": models.CaseReport,
             "biometric": models.BiometricEvidence}[key]
    row = db.query(model).get(record_id)
    if not row:
        raise HTTPException(404, "Evidence record not found.")

    sc = scope.get_scope(db, user)
    if not sc.is_admin:
        if key == "biometric":
            if not (row.case_id in sc.case_ids or row.person_id in sc.primary_ids):
                raise HTTPException(403, "You don't have access to this evidence record.")
        else:
            call_ids, financial_ids, cctv_ids, report_ids = scope.visible_evidence_ids(db, sc)
            id_set = {"call_record": call_ids, "financial_record": financial_ids,
                      "cctv_sighting": cctv_ids, "case_report": report_ids}[key]
            if record_id not in id_set:
                raise HTTPException(403, "You don't have access to this evidence record.")

    result = evidence_integrity.verify_record(db, key, record_id, user.analyst_id)
    log_audit(db, user, "Verified evidence integrity", resource=f"{evidence_type}:{record_id}",
              result="Verified" if result["status"] == "verified" else "Integrity Violation")
    return {"evidence_type": evidence_type, "record_id": record_id, **result}


@app.post("/api/admin/evidence/seal")
def seal_evidence(user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    """Recompute SHA-256 for every raw evidence record and anchor new/changed hashes into the
    immutable ledger. Backfills records ingested before integrity existed."""
    counts = evidence_integrity.seal_evidence(db, user.analyst_id)
    log_audit(db, user, "Sealed evidence with SHA-256",
              resource=f"{counts['new']} new, {counts['changed']} changed, {counts['unchanged']} unchanged")
    return {"message": "All evidence resealed and anchored in the ledger.",
            "records_hashed": counts["hashed"], "unchanged": counts["unchanged"], **counts}


# ===========================================================================
# CASES
# ===========================================================================
@app.get("/api/cases")
def list_cases(user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    sc = scope.get_scope(db, user)
    persons = db.query(models.Person).filter(models.Person.is_unresolved == False).all()
    by_case = {}
    for p in persons:
        if not p.case_id:
            continue
        if not sc.is_admin and p.case_id not in sc.case_ids:
            continue
        by_case.setdefault(p.case_id, []).append(p)
    cases_meta = {c.case_id: c for c in db.query(models.CaseFile).all()}
    out = []
    for cid, plist in by_case.items():
        meta = cases_meta.get(cid)
        rel_count = db.query(models.Relationship).filter(
            or_(models.Relationship.source_id.in_([p.id for p in plist]), models.Relationship.target_id.in_([p.id for p in plist]))
        ).count()
        out.append({
            "case_id": cid, "title": meta.title if meta else f"Investigation {cid}",
            "status": meta.status if meta else "Under Investigation",
            "opened_date": meta.opened_date if meta else None,
            "subject_count": len(plist), "relationship_count": rel_count,
            "crime_types": sorted({p.crime_type for p in plist if p.crime_type}),
        })
    out.sort(key=lambda c: c["case_id"])
    return out


@app.get("/api/cases/{case_id}")
def get_case(case_id: str, user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    sc = scope.get_scope(db, user)
    if not sc.can_see_case(case_id):
        raise HTTPException(403, "You don't have access to this case. You can request access "
                                  "from an Admin Investigator.")
    persons = db.query(models.Person).filter(models.Person.case_id == case_id, models.Person.is_unresolved == False).all()
    if not persons:
        raise HTTPException(404, "Case not found or has no linked subjects.")
    meta = db.query(models.CaseFile).get(case_id)
    G = analysis.build_graph(db)
    ids = {p.id for p in persons}
    edges = [r for r in db.query(models.Relationship).all() if r.source_id in ids or r.target_id in ids]
    reports = db.query(models.CaseReport).filter(models.CaseReport.case_id == case_id).all()
    indicators = [i for i in intelligence.generate_intelligence_indicators(db, G)
                  if any(e in ids for e in i.get("related_entities", []))]
    access = db.query(models.CaseAccess).filter(models.CaseAccess.case_id == case_id).all()
    history = db.query(models.CaseStatusHistory).filter(models.CaseStatusHistory.case_id == case_id) \
        .order_by(models.CaseStatusHistory.id.desc()).all()
    my_access = next((a for a in access if a.analyst_id == user.analyst_id), None)
    can_change_status = sc.is_admin or (my_access and my_access.access_level == "Read/Write")

    return {
        "case_id": case_id, "title": meta.title if meta else f"Investigation {case_id}",
        "status": meta.status if meta else "Under Investigation",
        "opened_date": meta.opened_date if meta else None,
        "allowed_statuses": CASE_STATUSES,
        "can_change_status": can_change_status,
        "status_history": [{"previous_status": h.previous_status, "new_status": h.new_status,
                            "changed_by": h.changed_by, "changed_at": h.changed_at,
                            "comment": h.comment} for h in history],
        "subjects": [{"id": p.id, "name": p.name, "crime_type": p.crime_type} for p in persons],
        "relationship_count": len(edges), "evidence_count": sum(len(json.loads(r.evidence)) for r in edges),
        "reports": [{"id": r.id, "title": r.title, "date_filed": r.date_filed, "officer": r.officer, "narrative_text": r.narrative_text} for r in reports],
        "intelligence_indicators": indicators,
        "assigned_investigators": [{"analyst_id": a.analyst_id, "access_level": a.access_level} for a in access],
    }


@app.post("/api/cases/{case_id}/status")
def change_case_status(case_id: str, body: schemas.CaseStatusChangeRequest,
                       user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    """Change a case's status. Only authorized users may do this: Admin Investigators, or an
    Investigator holding Read/Write access to the case (Read-Only grants cannot change status).
    Every change is recorded in the permanent status-history trail and the audit log."""
    sc = scope.get_scope(db, user)
    if not sc.can_see_case(case_id):
        raise HTTPException(403, "You don't have access to this case.")
    my_access = db.query(models.CaseAccess).filter(
        models.CaseAccess.case_id == case_id, models.CaseAccess.analyst_id == user.analyst_id).first()
    if not sc.is_admin and not (my_access and my_access.access_level == "Read/Write"):
        raise HTTPException(403, "Only Admin Investigators or investigators with Read/Write "
                                 "access to this case can change its status.")

    meta = db.query(models.CaseFile).get(case_id)
    if not meta:
        raise HTTPException(404, "Case file not found.")
    if body.new_status not in CASE_STATUSES:
        raise HTTPException(400, f"new_status must be one of: {', '.join(CASE_STATUSES)}.")
    if body.new_status == meta.status:
        raise HTTPException(400, f"Case is already '{meta.status}'.")

    previous = meta.status
    meta.status = body.new_status
    db.add(models.CaseStatusHistory(case_id=case_id, previous_status=previous,
                                    new_status=body.new_status, changed_by=user.analyst_id,
                                    comment=body.comment))
    db.commit()
    log_audit(db, user, "Changed case status", resource=f"{previous} -> {body.new_status}",
              case_id=case_id)
    return {"case_id": case_id, "status": meta.status, "previous_status": previous,
            "message": f"Case {case_id} status changed from '{previous}' to '{body.new_status}'."}


# ===========================================================================
# REPORTS
# ===========================================================================
@app.post("/api/reports/generate")
def generate_report(body: schemas.ReportGenerateRequest, user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    """Generates the PDF entirely in memory and streams it straight back - nothing is ever
    written to disk, so there is no generated_reports/ folder to accumulate files or leak into
    version control."""
    sc = scope.get_scope(db, user)
    if body.case_id and not sc.can_see_case(body.case_id):
        raise HTTPException(403, "You don't have access to this case.")
    if body.person_id and sc.person_access(body.person_id) != "full":
        raise HTTPException(403, "You don't have access to this subject.")

    content = reports.build_report_content(
        db, body.case_id, body.person_id, body.sections,
        generated_by=f"{user.name} ({user.analyst_id})",
        allowed_person_ids=None if sc.is_admin else sc.primary_ids,
    )
    filename, pdf_bytes = reports.render_pdf(content)
    log_audit(db, user, "Generated report", resource=filename, case_id=body.case_id)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ===========================================================================
# DASHBOARD
# ===========================================================================
@app.get("/api/dashboard")
def dashboard(user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    sc = scope.get_scope(db, user)
    persons = db.query(models.Person).filter(models.Person.is_unresolved == False).all()
    if not sc.is_admin:
        persons = [p for p in persons if p.id in sc.primary_ids]
    person_ids = {p.id for p in persons}

    relationships = scope.visible_relationship_query(db, sc)
    if not sc.is_admin:
        # Dashboard stats reflect only the investigator's own primary subjects, not bridge connections
        relationships = [r for r in relationships if r.source_id in person_ids and r.target_id in person_ids]
    G = scope.build_visible_graph(db, sc)
    communities = analysis.graph_communities(G)

    high = sum(1 for r in relationships if r.confidence >= 70)
    medium = sum(1 for r in relationships if 40 <= r.confidence < 70)
    low = sum(1 for r in relationships if r.confidence < 40)
    isolated = sum(1 for p in persons if G.degree(p.id) == 0) if persons else 0

    most_connected = None
    if persons and G.number_of_nodes() > 0:
        candidates = [(pid, deg) for pid, deg in G.degree if pid in person_ids]
        if candidates:
            top_id, top_degree = max(candidates, key=lambda kv: kv[1])
            if top_degree > 0:
                top_p = db.query(models.Person).get(top_id)
                most_connected = {"id": top_id, "name": top_p.name, "connections": top_degree}

    breakdown = {}
    for p in persons:
        key = p.crime_type or "Unclassified"
        breakdown[key] = breakdown.get(key, 0) + 1

    indicators = intelligence.generate_intelligence_indicators(db, G) if relationships else []
    if not sc.is_admin:
        indicators = [i for i in indicators if all(e in sc.visible_ids for e in i.get("related_entities", []))]

    default_subject = None
    if most_connected:
        p = db.query(models.Person).get(most_connected["id"])
        rels = intelligence._relationships_for(db, p.id)
        if not sc.is_admin:
            rels = [r for r in rels if sc.person_access(r["target_id"]) != "none"]
        pending = _pending_ids(db)
        default_subject = {
            "id": p.id, "name": p.name, "case_id": p.case_id, "crime_type": p.crime_type,
            "status": p.status, "reliability": intelligence.compute_reliability(db, p, rels, pending),
            "summary": intelligence.generate_entity_summary(p, rels, G),
        }

    if sc.is_admin:
        unresolved_count = db.query(models.Person).filter(models.Person.is_unresolved == True).count()
        evidence_counts = {
            "cdr": db.query(models.CallRecord).count(),
            "financial": db.query(models.FinancialRecord).count(),
            "cctv": db.query(models.CCTVSighting).count(),
            "reports": db.query(models.CaseReport).count(),
        }
    else:
        unresolved_count = len([p for p in db.query(models.Person).filter(models.Person.is_unresolved == True).all()
                                 if p.id in sc.bridge_ids])
        call_ids, financial_ids, cctv_ids, report_ids = scope.visible_evidence_ids(db, sc)
        evidence_counts = {"cdr": len(call_ids), "financial": len(financial_ids),
                            "cctv": len(cctv_ids), "reports": len(report_ids)}

    return {
        "total_entities": len(persons), "total_relationships": len(relationships),
        "high_confidence_links": high, "medium_confidence_links": medium, "low_confidence_links": low,
        "isolated_entities": isolated, "community_count": len(set(communities.values())) if communities else 0,
        "most_connected": most_connected, "crime_type_breakdown": breakdown,
        "analyzed": len(relationships) > 0 or len(persons) == 0,
        "unresolved_identifiers": unresolved_count,
        "intelligence_indicators": indicators[:6],
        "default_subject": default_subject,
        "evidence_source_counts": evidence_counts,
        "scope": "all" if sc.is_admin else "assigned_cases",
        "assigned_case_ids": sorted(sc.case_ids) if not sc.is_admin else None,
    }


# ===========================================================================
# ADMIN: AUDIT & PROVENANCE
# ===========================================================================
@app.get("/api/admin/audit")
def audit_log(user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db),
              action: Optional[str] = None, actor: Optional[str] = None):
    query = db.query(models.AuditLog)
    if action:
        query = query.filter(models.AuditLog.action.ilike(f"%{action}%"))
    if actor:
        query = query.filter(models.AuditLog.user == actor)
    rows = query.order_by(models.AuditLog.id.desc()).limit(200).all()
    return [{"id": r.id, "timestamp": r.timestamp, "user": r.user, "role": r.role,
             "action": r.action, "resource": r.resource, "case_id": r.case_id, "result": r.result} for r in rows]


# ===========================================================================
# ADMIN: USER MANAGEMENT
# ===========================================================================
@app.get("/api/admin/users")
def list_users(user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    users = db.query(models.User).all()
    out = []
    for u in users:
        case_count = db.query(models.CaseAccess).filter(models.CaseAccess.analyst_id == u.analyst_id).count()
        out.append({"id": u.id, "analyst_id": u.analyst_id, "name": u.name, "role": u.role,
                    "status": u.status, "assigned_cases": case_count, "last_active": u.last_active})
    return out


@app.post("/api/admin/users")
def create_user(body: schemas.UserCreateRequest, user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    if body.role not in ("investigator", "admin_investigator"):
        raise HTTPException(400, "Role must be 'investigator' or 'admin_investigator'.")
    if db.query(models.User).filter(models.User.analyst_id == body.analyst_id).first():
        raise HTTPException(400, "Analyst ID already exists.")
    new_user = models.User(analyst_id=body.analyst_id, name=body.name,
                            password_hash=auth.hash_password(body.password), role=body.role, status="Active")
    db.add(new_user)
    db.commit()
    log_audit(db, user, "Created user", resource=body.analyst_id)
    return {"message": "User created.", "analyst_id": body.analyst_id}


@app.post("/api/admin/users/{analyst_id}/deactivate")
def deactivate_user(analyst_id: str, user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    target = db.query(models.User).filter(models.User.analyst_id == analyst_id).first()
    if not target:
        raise HTTPException(404, "User not found.")
    if target.analyst_id == user.analyst_id:
        raise HTTPException(400, "You cannot deactivate your own account.")
    target.status = "Inactive" if target.status == "Active" else "Active"
    db.commit()
    log_audit(db, user, f"Set user status to {target.status}", resource=analyst_id)
    return {"message": f"User status set to {target.status}."}


@app.patch("/api/admin/users/{analyst_id}")
def update_user(analyst_id: str, body: schemas.UserUpdateRequest,
                 user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    target = db.query(models.User).filter(models.User.analyst_id == analyst_id).first()
    if not target:
        raise HTTPException(404, "User not found.")

    changes = []

    if body.name is not None:
        if not body.name.strip():
            raise HTTPException(400, "Name cannot be empty.")
        old_name = target.name
        target.name = body.name.strip()
        changes.append(f"renamed '{old_name}' to '{target.name}'")

    if body.role is not None:
        if body.role not in ("investigator", "admin_investigator"):
            raise HTTPException(400, "Role must be 'investigator' or 'admin_investigator'.")
        if target.analyst_id == user.analyst_id and body.role != target.role:
            raise HTTPException(400, "You cannot change your own role. Ask another Admin Investigator to do this.")
        if target.role == "admin_investigator" and body.role == "investigator":
            remaining_admins = db.query(models.User).filter(
                models.User.role == "admin_investigator", models.User.analyst_id != analyst_id
            ).count()
            if remaining_admins == 0:
                raise HTTPException(400, "Cannot demote the last remaining Admin Investigator account.")
        if body.role != target.role:
            old_role = target.role
            target.role = body.role
            changes.append(f"role changed from '{old_role}' to '{body.role}'")

    if body.new_password is not None:
        if len(body.new_password) < 6:
            raise HTTPException(400, "Password must be at least 6 characters.")
        target.password_hash = auth.hash_password(body.new_password)
        changes.append("password reset")

    if not changes:
        raise HTTPException(400, "No changes provided.")

    db.commit()
    log_audit(db, user, f"Updated user ({'; '.join(changes)})", resource=analyst_id)
    return {"message": "User updated.", "name": target.name, "role": target.role}


@app.delete("/api/admin/users/{analyst_id}")
def delete_user(analyst_id: str, user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    target = db.query(models.User).filter(models.User.analyst_id == analyst_id).first()
    if not target:
        raise HTTPException(404, "User not found.")
    if target.analyst_id == user.analyst_id:
        raise HTTPException(400, "You cannot delete your own account.")
    if target.role == "admin_investigator":
        remaining_admins = db.query(models.User).filter(
            models.User.role == "admin_investigator", models.User.analyst_id != analyst_id
        ).count()
        if remaining_admins == 0:
            raise HTTPException(400, "Cannot delete the last remaining Admin Investigator account.")

    db.query(models.CaseAccess).filter(models.CaseAccess.analyst_id == analyst_id).delete()
    db.delete(target)
    db.commit()
    log_audit(db, user, "Deleted user", resource=analyst_id)
    return {"message": f"User {analyst_id} permanently deleted."}


# ===========================================================================
# ADMIN: ACCESS CONTROL
# ===========================================================================
@app.get("/api/admin/access-control")
def list_access(user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    rows = db.query(models.CaseAccess).all()
    return [{"id": r.id, "case_id": r.case_id, "analyst_id": r.analyst_id, "access_level": r.access_level} for r in rows]


@app.post("/api/admin/access-control")
def assign_access(body: schemas.AccessAssignRequest, user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    if not db.query(models.User).filter(models.User.analyst_id == body.analyst_id).first():
        raise HTTPException(404, "Analyst not found.")
    existing = db.query(models.CaseAccess).filter(
        models.CaseAccess.case_id == body.case_id, models.CaseAccess.analyst_id == body.analyst_id
    ).first()
    if existing:
        raise HTTPException(400, f"{body.analyst_id} already has access to case {body.case_id}.")
    db.add(models.CaseAccess(case_id=body.case_id, analyst_id=body.analyst_id, access_level=body.access_level))
    db.commit()
    log_audit(db, user, "Assigned case access", resource=body.analyst_id, case_id=body.case_id)
    return {"message": "Access assigned."}


@app.delete("/api/admin/access-control/{access_id}")
def remove_access(access_id: int, user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    row = db.query(models.CaseAccess).get(access_id)
    if not row:
        raise HTTPException(404, "Access record not found.")
    db.delete(row)
    db.commit()
    log_audit(db, user, "Removed case access", resource=row.analyst_id, case_id=row.case_id)
    return {"message": "Access removed."}


# ===========================================================================
# CASE MESSAGING - a shared discussion thread per case, for co-assigned investigators
# ===========================================================================
@app.get("/api/cases/{case_id}/messages")
def list_case_messages(case_id: str, user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    sc = scope.get_scope(db, user)
    if not sc.can_see_case(case_id):
        raise HTTPException(403, "You don't have access to this case.")
    rows = db.query(models.CaseMessage).filter(models.CaseMessage.case_id == case_id) \
        .order_by(models.CaseMessage.created_at).all()
    return [{"id": m.id, "sender_analyst_id": m.sender_analyst_id, "sender_name": m.sender_name,
             "message": m.message, "created_at": m.created_at, "is_own": m.sender_analyst_id == user.analyst_id}
            for m in rows]


@app.post("/api/cases/{case_id}/messages")
def post_case_message(case_id: str, body: schemas.CaseMessageCreate,
                       user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    sc = scope.get_scope(db, user)
    if not sc.can_see_case(case_id):
        raise HTTPException(403, "You don't have access to this case.")
    if not body.message.strip():
        raise HTTPException(400, "Message cannot be empty.")
    msg = models.CaseMessage(case_id=case_id, sender_analyst_id=user.analyst_id,
                              sender_name=user.name, message=body.message.strip())
    db.add(msg)
    db.commit()
    log_audit(db, user, "Posted case message", case_id=case_id)
    return {"message": "Sent."}


# ===========================================================================
# ACCESS REQUESTS - an Investigator asks for data outside their assignment;
# an Admin Investigator reviews and approves/denies.
# ===========================================================================
@app.get("/api/access-requests")
def list_access_requests(user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    query = db.query(models.AccessRequest)
    if user.role != "admin_investigator":
        query = query.filter(models.AccessRequest.requested_by == user.analyst_id)
    rows = query.order_by(models.AccessRequest.id.desc()).all()
    return [{
        "id": r.id, "requested_by": r.requested_by, "requester_name": r.requester_name,
        "request_type": r.request_type, "target_id": r.target_id, "target_label": r.target_label,
        "reason": r.reason, "status": r.status, "admin_note": r.admin_note,
        "reviewed_by": r.reviewed_by, "reviewed_at": r.reviewed_at, "created_at": r.created_at,
    } for r in rows]


@app.post("/api/access-requests")
def create_access_request(body: schemas.AccessRequestCreate, user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    if body.request_type not in ("case", "person"):
        raise HTTPException(400, "request_type must be 'case' or 'person'.")
    if not body.reason.strip():
        raise HTTPException(400, "Please provide a reason for this request.")

    sc = scope.get_scope(db, user)
    target_label = None
    if body.request_type == "case":
        if sc.can_see_case(body.target_id):
            raise HTTPException(400, "You already have access to this case.")
        meta = db.query(models.CaseFile).get(body.target_id)
        target_label = meta.title if meta else body.target_id
    else:
        person = db.query(models.Person).get(body.target_id)
        if not person:
            raise HTTPException(404, "Subject not found.")
        if sc.person_access(body.target_id) == "full":
            raise HTTPException(400, "You already have full access to this subject.")
        target_label = person.name

    existing = db.query(models.AccessRequest).filter(
        models.AccessRequest.requested_by == user.analyst_id, models.AccessRequest.target_id == body.target_id,
        models.AccessRequest.request_type == body.request_type, models.AccessRequest.status == "Pending",
    ).first()
    if existing:
        raise HTTPException(400, "You already have a pending request for this.")

    req = models.AccessRequest(requested_by=user.analyst_id, requester_name=user.name,
                                request_type=body.request_type, target_id=body.target_id,
                                target_label=target_label, reason=body.reason.strip())
    db.add(req)
    db.commit()
    log_audit(db, user, "Requested access", resource=f"{body.request_type}:{body.target_id}")
    return {"message": "Access request submitted."}


@app.post("/api/admin/access-requests/{req_id}/approve")
def approve_access_request(req_id: int, body: schemas.AccessRequestReviewRequest,
                            user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    req = db.query(models.AccessRequest).get(req_id)
    if not req:
        raise HTTPException(404, "Request not found.")
    if req.status != "Pending":
        raise HTTPException(400, f"This request has already been {req.status.lower()}.")

    if req.request_type == "case":
        existing = db.query(models.CaseAccess).filter(
            models.CaseAccess.case_id == req.target_id, models.CaseAccess.analyst_id == req.requested_by
        ).first()
        if not existing:
            db.add(models.CaseAccess(case_id=req.target_id, analyst_id=req.requested_by, access_level="Read Only"))
    else:
        existing = db.query(models.PersonAccessGrant).filter(
            models.PersonAccessGrant.person_id == req.target_id, models.PersonAccessGrant.analyst_id == req.requested_by
        ).first()
        if not existing:
            db.add(models.PersonAccessGrant(analyst_id=req.requested_by, person_id=req.target_id, granted_by=user.analyst_id))

    req.status = "Approved"
    req.admin_note = body.admin_note
    req.reviewed_by = user.analyst_id
    req.reviewed_at = datetime.utcnow()
    db.commit()
    log_audit(db, user, "Approved access request", resource=f"{req.request_type}:{req.target_id}")
    return {"message": "Access request approved and granted."}


@app.post("/api/admin/access-requests/{req_id}/deny")
def deny_access_request(req_id: int, body: schemas.AccessRequestReviewRequest,
                         user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    req = db.query(models.AccessRequest).get(req_id)
    if not req:
        raise HTTPException(404, "Request not found.")
    if req.status != "Pending":
        raise HTTPException(400, f"This request has already been {req.status.lower()}.")
    req.status = "Denied"
    req.admin_note = body.admin_note
    req.reviewed_by = user.analyst_id
    req.reviewed_at = datetime.utcnow()
    db.commit()
    log_audit(db, user, "Denied access request", resource=f"{req.request_type}:{req.target_id}")
    return {"message": "Access request denied."}


# ===========================================================================
# ADMIN: SECURITY (live integrity / alerts / ledger) - integrated into the
# existing security model, not a disconnected demo module.
# ===========================================================================
@app.get("/api/admin/security")
def security_status(user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    chain = ledger.HashChainLedger(db)
    chain_summary = chain.summarize()
    open_alerts = db.query(models.SecurityEvent).filter(models.SecurityEvent.status == "Open").count()
    active_tamper = db.query(models.DemoTamperRecord).filter(models.DemoTamperRecord.status == "Active").count()
    evidence_total = (db.query(models.Person).filter(models.Person.is_unresolved == False).count()
                      + db.query(models.CallRecord).count() + db.query(models.FinancialRecord).count()
                      + db.query(models.CCTVSighting).count() + db.query(models.CaseReport).count()
                      + db.query(models.BiometricEvidence).count())
    recent = db.query(models.SecurityEvent).order_by(models.SecurityEvent.id.desc()).limit(8).all()
    return {
        "system_status": "Secure" if open_alerts == 0 else "Attention Required",
        "authentication": "Active (JWT, 12h session expiry)",
        "role_based_access_control": "Enabled",
        "audit_logging": "Enabled",
        "data_provenance": "Enabled - every relationship traceable to source records",
        "encryption_at_rest": "Not applicable (local demo database)",
        "current_admin": {"analyst_id": user.analyst_id, "name": user.name, "role": user.role},
        # Live integrity + ledger posture (not static text)
        "evidence_hashed": db.query(models.EvidenceHash).count(),
        "evidence_total": evidence_total,
        "ledger_blocks": chain_summary["block_count"],
        "chain_valid": chain_summary["chain_valid"],
        "ledger_backend": chain_summary["backend"],
        "ledger_label": chain_summary["label"],
        "ledger_last_hash": chain_summary["last_block"]["hash"] if chain_summary["last_block"] else None,
        "open_alerts": open_alerts,
        "active_tamper": active_tamper,
        "recent_events": [{
            "id": e.id, "event_type": e.event_type, "severity": e.severity,
            "evidence_type": e.evidence_type, "record_id": e.record_id, "case_id": e.case_id,
            "detected_by": e.detected_by, "detected_at": e.detected_at,
            "expected_hash": e.expected_hash, "current_hash": e.current_hash, "status": e.status,
        } for e in recent],
    }


@app.get("/api/admin/security/events")
def list_security_events(user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db),
                         status: Optional[str] = None):
    query = db.query(models.SecurityEvent)
    if status:
        query = query.filter(models.SecurityEvent.status == status)
    rows = query.order_by(models.SecurityEvent.id.desc()).limit(200).all()
    return [{
        "id": e.id, "event_type": e.event_type, "severity": e.severity,
        "evidence_type": e.evidence_type, "record_id": e.record_id, "case_id": e.case_id,
        "detected_by": e.detected_by, "detected_at": e.detected_at,
        "expected_hash": e.expected_hash, "current_hash": e.current_hash,
        "description": e.description, "status": e.status,
    } for e in rows]


@app.post("/api/admin/security/events/{event_id}/ack")
def ack_security_event(event_id: int, user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    e = db.query(models.SecurityEvent).get(event_id)
    if not e:
        raise HTTPException(404, "Security event not found.")
    e.status = "Acknowledged"
    db.commit()
    log_audit(db, user, "Acknowledged security event", resource=f"{e.evidence_type}:{e.record_id}")
    return {"message": "Event acknowledged.", "status": e.status}


@app.post("/api/admin/security/simulate-tamper")
def simulate_tamper(body: schemas.SimulateTamperRequest,
                    user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    """DEMO-ONLY. Controlled modification of ONE demonstration evidence record so the next
    verification genuinely detects an integrity violation. The original value is preserved in
    a DemoTamperRecord and can be fully restored afterwards; SecurityEvents, audit log and
    ledger history are NEVER removed by that restore."""
    key = evidence_integrity.normalize_evidence_type(body.evidence_type)
    if not key:
        raise HTTPException(400, "Unknown evidence type.")
    try:
        result = evidence_integrity.simulate_tamper(db, key, body.record_id,
                                                    body.field_name, body.tampered_value, user.analyst_id)
    except ValueError as exc:
        msg = {
            "unknown_evidence_type": "Unknown evidence type.",
            "record_not_found": "Evidence record not found.",
            "not_sealed": "This record has not been sealed yet. Run 'Seal Evidence' or Processing first.",
            "tamper_already_active": "This record already has an Active demo tamper. Restore it first.",
            "unknown_field": "That field does not exist on this evidence type.",
            "tamper_value_unchanged": "Tampered value is identical to the current value.",
        }.get(str(exc), str(exc))
        raise HTTPException(400, msg)
    log_audit(db, user, "Simulated evidence tamper (DEMO-ONLY)", resource=f"{body.evidence_type}:{body.record_id}")
    return {"message": "Demo tamper applied. Run evidence verification to detect the violation.",
            **result, "demo_only": True,
            "warning": "DEMO-ONLY action. Security/audit history is retained permanently; "
                       "restore the original value when the demonstration is over."}


@app.post("/api/admin/security/restore-tampered-evidence")
def restore_tampered_evidence(body: schemas.RestoreTamperRequest,
                              user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    """DEMO-ONLY. Restores the exact original value captured at tamper time so the seeded
    dataset is not permanently corrupted. Does NOT delete the SecurityEvent, audit log or
    ledger entries that documented the violation."""
    key = evidence_integrity.normalize_evidence_type(body.evidence_type)
    if not key:
        raise HTTPException(400, "Unknown evidence type.")
    try:
        result = evidence_integrity.restore_tamper(db, key, body.record_id, user.analyst_id)
    except ValueError:
        raise HTTPException(400, "No Active demo tamper found for this record.")
    log_audit(db, user, "Restored demo tampered evidence (DEMO-ONLY)",
              resource=f"{body.evidence_type}:{body.record_id}")
    return {"message": "Original value restored. Integrity/audit history retained.",
            **result, "demo_only": True}


@app.get("/api/admin/security/tamper-records")
def list_demo_tampers(user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    rows = db.query(models.DemoTamperRecord).order_by(models.DemoTamperRecord.id.desc()).all()
    return [{
        "id": t.id, "evidence_type": t.evidence_type, "record_id": t.record_id,
        "evidence_type_label": evidence_integrity.EVIDENCE_TYPES.get(t.evidence_type, (t.evidence_type,))[0],
        "field_name": t.field_name, "original_value": t.original_value,
        "tampered_value": t.tampered_value, "case_id": t.case_id,
        "applied_by": t.applied_by, "applied_at": t.applied_at, "status": t.status,
        "restored_by": t.restored_by, "restored_at": t.restored_at,
    } for t in rows]


# ===========================================================================
# IMMUTABLE LEDGER (blockchain-ready adapter) - admin view + verification
# ===========================================================================
@app.get("/api/admin/ledger")
def ledger_view(user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    chain = ledger.HashChainLedger(db)
    summary = chain.summarize()
    return {**summary, "blocks": ledger.block_list(db)}


@app.post("/api/admin/ledger/verify")
def ledger_verify(user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    """Recompute and re-check the entire hash chain - any tampering of a past block (including
    of the app-side hash registry the chain is anchored against) breaks it."""
    chain = ledger.HashChainLedger(db)
    result = chain.verify_chain(db)
    log_audit(db, user, "Verified ledger chain",
              resource=f"blocks:{result['blocks']}", result="Valid" if result["valid"] else "Broken")
    return result


# ===========================================================================
# BIOMETRICS - provenance/metadata extension point, honest future-capability state
# ===========================================================================
@app.post("/api/admin/evidence/biometric/register")
def register_biometric(body: schemas.BiometricRegisterRequest,
                       user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    if body.modality not in biometrics.BIOMETRIC_MODALITIES:
        raise HTTPException(400, f"modality must be one of: {', '.join(biometrics.BIOMETRIC_MODALITIES)}.")
    be = models.BiometricEvidence(person_id=body.person_id, person_name=body.person_name,
                                  modality=body.modality, source_file=body.source_file,
                                  captured_at=body.captured_at, location=body.location,
                                  case_id=body.case_id, provenance_notes=body.provenance_notes)
    db.add(be)
    db.commit()
    db.refresh(be)
    evidence_integrity.seal_evidence(db, user.analyst_id)
    log_audit(db, user, "Registered biometric evidence (metadata)", resource=f"biometric:{be.id}")
    return {"message": "Biometric evidence registered (provenance/metadata only).",
            "id": be.id, "person_id": be.person_id, "modality": be.modality,
            "match_available": False}


@app.get("/api/evidence/biometric")
def list_biometric(user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    sc = scope.get_scope(db, user)
    rows = db.query(models.BiometricEvidence).order_by(models.BiometricEvidence.id.desc()).all()
    if not sc.is_admin:
        rows = [r for r in rows if r.case_id in sc.case_ids or r.person_id in sc.primary_ids]
    return [{
        "id": r.id, "person_id": r.person_id, "person_name": r.person_name,
        "modality": r.modality, "source_file": r.source_file, "captured_at": r.captured_at,
        "location": r.location, "case_id": r.case_id, "provenance_notes": r.provenance_notes,
        "algorithm": r.algorithm, "status": r.status, "match_available": False,
    } for r in rows]


@app.post("/api/evidence/biometric/{bid}/match")
def biometric_match(bid: int, user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    """Biometric analysis is an advanced/future capability: until a real matching engine is
    connected via BiometricsBackend, this returns a clear 'not configured' result instead of
    fabricating scores."""
    r = db.query(models.BiometricEvidence).get(bid)
    if not r:
        raise HTTPException(404, "Biometric evidence not found.")
    sc = scope.get_scope(db, user)
    if not sc.is_admin and not (r.case_id in sc.case_ids or r.person_id in sc.primary_ids):
        raise HTTPException(403, "You don't have access to this record.")
    backend = biometrics.get_biometrics_backend()
    sample = {"id": r.id, "person_id": r.person_id, "modality": r.modality, "case_id": r.case_id,
              "location": r.location}
    log_audit(db, user, "Requested biometric match", resource=f"biometric:{r.id}")
    return backend.match(sample, [])


# ===========================================================================
# ADMIN: BACKUP (create/download; restore intentionally deferred & documented)
# ===========================================================================
@app.post("/api/admin/backup")
def create_backup(user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    info = backup_mod.create_backup(db, user.analyst_id)
    log_audit(db, user, "Created backup", resource=info["filename"])
    return {"message": "Backup created.", **info}


@app.get("/api/admin/backup")
def list_backups(user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    return backup_mod.list_backups(db)


@app.get("/api/admin/backup/{backup_id}/download")
def download_backup(backup_id: int, user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    filepath, rec = backup_mod.backup_path(db, backup_id)
    if not filepath:
        raise HTTPException(404, "Backup file not found (it may have been cleaned from disk).")
    log_audit(db, user, "Downloaded backup", resource=rec.filename)
    return FileResponse(filepath, media_type="application/gzip",
                        filename=rec.filename)


# ===========================================================================
# RESET (admin only) - wipes all case data, keeps user accounts
# ===========================================================================
@app.post("/api/admin/reset")
def reset_all(user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    for model in [models.Relationship, models.EntityResolutionCandidate, models.ProcessingJob,
                  models.CaseFile, models.CaseAccess, models.CallRecord, models.FinancialRecord,
                  models.CCTVSighting, models.CaseReport, models.Person, models.IngestedFile,
                  models.CaseMessage, models.AccessRequest, models.PersonAccessGrant,
                  models.EvidenceHash, models.SecurityEvent, models.CaseStatusHistory,
                  models.DemoTamperRecord, models.BiometricEvidence]:
        db.query(model).delete()
    db.commit()
    log_audit(db, user, "Reset all case data")
    return {"message": "All case data cleared. User accounts preserved."}