import csv
import io
import json
import os
import threading
import time
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import or_

from . import models, schemas, analysis, intelligence, auth, seed, reports
from .database import Base, engine, get_db, SessionLocal

Base.metadata.create_all(bind=engine)
with SessionLocal() as _db:
    seed.seed_users(_db)

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
async def upload_dataset(dataset_type: str, file: UploadFile = File(...),
                          user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    if dataset_type not in DATASET_CONFIG:
        raise HTTPException(400, f"Unknown dataset type '{dataset_type}'.")
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
    db.query(model).delete()  # replace this dataset type fresh on each upload

    inserted, skipped = 0, 0
    for row in reader:
        row = {(k.strip() if k else k): (v.strip() if isinstance(v, str) else v)
               for k, v in row.items() if k is not None}
        if not row.get("id"):
            skipped += 1
            continue
        kwargs = _row_to_kwargs(model, row)
        try:
            db.merge(model(**kwargs))
            inserted += 1
        except Exception:
            skipped += 1
    db.commit()

    db.query(models.IngestedFile).filter(models.IngestedFile.dataset_type == dataset_type).delete()
    db.add(models.IngestedFile(dataset_type=dataset_type, filename=file.filename, uploaded_by=user.analyst_id,
                                records_count=inserted, status="Uploaded"))
    db.commit()
    log_audit(db, user, "Uploaded dataset", resource=f"{dataset_type}:{file.filename}")

    return {"message": f"{inserted} record(s) parsed from {file.filename}.",
            "records_inserted": inserted, "records_skipped": skipped}


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


# ===========================================================================
# PROCESSING PIPELINE (admin only) - runs in a background thread, pollable
# ===========================================================================
STAGE_NAMES = [
    "Data Validation", "Data Cleaning", "Entity Extraction (NLP/CV)",
    "Entity Resolution", "Relationship & Graph Construction",
    "Graph Analytics", "Pattern Analysis",
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

        # sync derived cases table
        db.query(models.CaseFile).delete()
        case_ids = {p.case_id for p in db.query(models.Person).filter(models.Person.is_unresolved == False).all() if p.case_id}
        for cid in case_ids:
            report = db.query(models.CaseReport).filter(models.CaseReport.case_id == cid).order_by(models.CaseReport.date_filed).first()
            db.add(models.CaseFile(case_id=cid, title=report.title if report else f"Investigation {cid}",
                                    status="Under Investigation", opened_date=report.date_filed if report else None))
        db.commit()

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
    rows = db.query(models.EntityResolutionCandidate).order_by(models.EntityResolutionCandidate.similarity.desc()).all()
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
    pending = _pending_ids(db)

    results = []
    for p in persons:
        rels = intelligence._relationships_for(db, p.id)
        reliability = intelligence.compute_reliability(db, p, rels, pending)
        results.append({
            "id": p.id, "name": p.name, "crime_type": p.crime_type, "city": p.city, "case_id": p.case_id,
            "is_unresolved": p.is_unresolved, "connection_count": len(rels),
            "max_confidence": max((r["confidence"] for r in rels), default=0.0),
            "reliability": reliability["overall"],
        })
    results.sort(key=lambda r: r["connection_count"], reverse=True)
    return results


@app.get("/api/entities/{entity_id}")
def get_entity(entity_id: str, user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    p = db.query(models.Person).get(entity_id)
    if not p:
        raise HTTPException(404, "Entity not found.")

    rels = intelligence._relationships_for(db, entity_id)
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
    }


# ===========================================================================
# GRAPH
# ===========================================================================
@app.get("/api/graph")
def get_graph(user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db),
              min_confidence: float = 0, categories: Optional[str] = None):
    cat_filter = set(categories.split(",")) if categories else None
    persons = db.query(models.Person).all()
    G = analysis.build_graph(db)
    communities = analysis.graph_communities(G)

    nodes = []
    for p in persons:
        degree = G.degree(p.id) if p.id in G else 0
        nodes.append({
            "id": p.id, "name": p.name, "crime_type": p.crime_type, "case_id": p.case_id,
            "subtype": analysis.node_subtype(p), "degree": degree,
            "community": communities.get(p.id, -1), "isolated": degree == 0,
        })

    edges = []
    for r in db.query(models.Relationship).all():
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
    G = analysis.build_graph(db)
    persons = {p.id: p for p in db.query(models.Person).all()}
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
    G = analysis.build_graph(db)
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
    events = []
    persons = db.query(models.Person).filter(models.Person.is_unresolved == False)
    if case_id:
        persons = persons.filter(models.Person.case_id == case_id)
    person_ids = {p.id for p in persons.all()}
    phones = {p.phone for p in persons.all() if p.phone} | {p.alt_phone for p in persons.all() if p.alt_phone}
    accounts = {p.account_number for p in persons.all() if p.account_number}

    for call in db.query(models.CallRecord).all():
        if case_id and call.caller_phone not in phones and call.receiver_phone not in phones:
            continue
        events.append({"timestamp": call.timestamp, "type": "CDR Event", "id": call.id,
                        "description": f"{('SMS' if (call.call_type or '').lower()=='sms' else 'Call')}: {call.caller_phone} -> {call.receiver_phone}",
                        "source": "cdr_records.csv"})
    for tx in db.query(models.FinancialRecord).all():
        if case_id and tx.sender_account not in accounts and tx.receiver_account not in accounts:
            continue
        events.append({"timestamp": tx.timestamp, "type": "Financial Event", "id": tx.id,
                        "description": f"₹{tx.amount:,.0f} transferred {tx.sender_account} -> {tx.receiver_account}",
                        "source": "financial_records.csv"})
    for s in db.query(models.CCTVSighting).all():
        events.append({"timestamp": s.timestamp, "type": "CCTV Observation", "id": s.id,
                        "description": f"{s.location}: {s.description}", "source": "cctv_sightings.csv"})
    for r in db.query(models.CaseReport).all():
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
    items = []
    for call in db.query(models.CallRecord).all():
        items.append({"evidence_type": "CDR", "id": call.id, "timestamp": call.timestamp,
                       "summary": f"{call.caller_phone} -> {call.receiver_phone} ({call.duration_seconds}s)",
                       "source_file": "cdr_records.csv"})
    for tx in db.query(models.FinancialRecord).all():
        items.append({"evidence_type": "Financial", "id": tx.id, "timestamp": tx.timestamp,
                       "summary": f"₹{tx.amount:,.0f} {tx.sender_account} -> {tx.receiver_account}",
                       "source_file": "financial_records.csv"})
    for s in db.query(models.CCTVSighting).all():
        items.append({"evidence_type": "CCTV", "id": s.id, "timestamp": s.timestamp,
                       "summary": f"{s.location}: {s.description}", "source_file": "cctv_sightings.csv"})
    for r in db.query(models.CaseReport).all():
        items.append({"evidence_type": "Report", "id": r.id, "timestamp": r.date_filed,
                       "summary": f"{r.title} ({r.case_id})", "source_file": "investigation_reports.csv"})
    if evidence_type:
        items = [i for i in items if i["evidence_type"] == evidence_type]
    if q:
        ql = q.lower()
        items = [i for i in items if ql in i["summary"].lower() or ql in i["id"].lower()]
    items.sort(key=lambda i: i["timestamp"] or "", reverse=True)
    return items


@app.get("/api/evidence/{evidence_type}/{record_id}")
def evidence_detail(evidence_type: str, record_id: str, user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    model_map = {"CDR": models.CallRecord, "Financial": models.FinancialRecord,
                 "CCTV": models.CCTVSighting, "Report": models.CaseReport}
    model = model_map.get(evidence_type)
    if not model:
        raise HTTPException(400, "Unknown evidence type.")
    row = db.query(model).get(record_id)
    if not row:
        raise HTTPException(404, "Evidence record not found.")
    result = {c.name: getattr(row, c.name) for c in row.__table__.columns}

    contributes_to = []
    for rel in db.query(models.Relationship).all():
        for e in json.loads(rel.evidence):
            if record_id in (e.get("record_ids") or []) or record_id == str(e.get("record_id") or ""):
                a = db.query(models.Person).get(rel.source_id)
                b = db.query(models.Person).get(rel.target_id)
                contributes_to.append({"relationship_id": rel.id, "source_name": a.name if a else rel.source_id,
                                        "target_name": b.name if b else rel.target_id, "confidence": rel.confidence})
    return {"record": result, "contributes_to_relationships": contributes_to}


# ===========================================================================
# CASES
# ===========================================================================
@app.get("/api/cases")
def list_cases(user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    persons = db.query(models.Person).filter(models.Person.is_unresolved == False).all()
    by_case = {}
    for p in persons:
        if not p.case_id:
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

    return {
        "case_id": case_id, "title": meta.title if meta else f"Investigation {case_id}",
        "status": meta.status if meta else "Under Investigation",
        "opened_date": meta.opened_date if meta else None,
        "subjects": [{"id": p.id, "name": p.name, "crime_type": p.crime_type} for p in persons],
        "relationship_count": len(edges), "evidence_count": sum(len(json.loads(r.evidence)) for r in edges),
        "reports": [{"id": r.id, "title": r.title, "date_filed": r.date_filed, "officer": r.officer, "narrative_text": r.narrative_text} for r in reports],
        "intelligence_indicators": indicators,
        "assigned_investigators": [{"analyst_id": a.analyst_id, "access_level": a.access_level} for a in access],
    }


# ===========================================================================
# REPORTS
# ===========================================================================
@app.post("/api/reports/generate")
def generate_report(body: schemas.ReportGenerateRequest, user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    content = reports.build_report_content(db, body.case_id, body.person_id, body.sections,
                                            generated_by=f"{user.name} ({user.analyst_id})")
    filename = reports.render_pdf(content)
    log_audit(db, user, "Generated report", resource=filename, case_id=body.case_id)
    return {"filename": filename, "download_url": f"/api/reports/download/{filename}"}


@app.get("/api/reports/download/{filename}")
def download_report(filename: str, user: models.User = Depends(auth.get_current_user)):
    path = os.path.join(reports.REPORTS_DIR, filename)
    if not os.path.isfile(path):
        raise HTTPException(404, "Report not found.")
    return FileResponse(path, media_type="application/pdf", filename=filename)


# ===========================================================================
# DASHBOARD
# ===========================================================================
@app.get("/api/dashboard")
def dashboard(user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    persons = db.query(models.Person).filter(models.Person.is_unresolved == False).all()
    relationships = db.query(models.Relationship).all()
    G = analysis.build_graph(db)
    communities = analysis.graph_communities(G)

    high = sum(1 for r in relationships if r.confidence >= 70)
    medium = sum(1 for r in relationships if 40 <= r.confidence < 70)
    low = sum(1 for r in relationships if r.confidence < 40)
    isolated = sum(1 for p in persons if G.degree(p.id) == 0) if persons else 0

    most_connected = None
    if persons and G.number_of_nodes() > 0:
        candidates = [(pid, deg) for pid, deg in G.degree if pid in {p.id for p in persons}]
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

    default_subject = None
    if most_connected:
        p = db.query(models.Person).get(most_connected["id"])
        rels = intelligence._relationships_for(db, p.id)
        pending = _pending_ids(db)
        default_subject = {
            "id": p.id, "name": p.name, "case_id": p.case_id, "crime_type": p.crime_type,
            "status": p.status, "reliability": intelligence.compute_reliability(db, p, rels, pending),
            "summary": intelligence.generate_entity_summary(p, rels, G),
        }

    unresolved_count = db.query(models.Person).filter(models.Person.is_unresolved == True).count()

    return {
        "total_entities": len(persons), "total_relationships": len(relationships),
        "high_confidence_links": high, "medium_confidence_links": medium, "low_confidence_links": low,
        "isolated_entities": isolated, "community_count": len(set(communities.values())) if communities else 0,
        "most_connected": most_connected, "crime_type_breakdown": breakdown,
        "analyzed": len(relationships) > 0 or len(persons) == 0,
        "unresolved_identifiers": unresolved_count,
        "intelligence_indicators": indicators[:6],
        "default_subject": default_subject,
        "evidence_source_counts": {
            "cdr": db.query(models.CallRecord).count(),
            "financial": db.query(models.FinancialRecord).count(),
            "cctv": db.query(models.CCTVSighting).count(),
            "reports": db.query(models.CaseReport).count(),
        },
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
    target.status = "Inactive" if target.status == "Active" else "Active"
    db.commit()
    log_audit(db, user, f"Set user status to {target.status}", resource=analyst_id)
    return {"message": f"User status set to {target.status}."}


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
# ADMIN: SECURITY (static status)
# ===========================================================================
@app.get("/api/admin/security")
def security_status(user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    return {
        "system_status": "Secure",
        "authentication": "Active (JWT, 12h session expiry)",
        "role_based_access_control": "Enabled",
        "audit_logging": "Enabled",
        "data_provenance": "Enabled - every relationship traceable to source records",
        "encryption_at_rest": "Not applicable (local demo database)",
        "current_admin": {"analyst_id": user.analyst_id, "name": user.name, "role": user.role},
    }


# ===========================================================================
# RESET (admin only) - wipes all case data, keeps user accounts
# ===========================================================================
@app.post("/api/admin/reset")
def reset_all(user: models.User = Depends(auth.require_admin), db: Session = Depends(get_db)):
    for model in [models.Relationship, models.EntityResolutionCandidate, models.ProcessingJob,
                  models.CaseFile, models.CaseAccess, models.CallRecord, models.FinancialRecord,
                  models.CCTVSighting, models.CaseReport, models.Person, models.IngestedFile]:
        db.query(model).delete()
    db.commit()
    log_audit(db, user, "Reset all case data")
    return {"message": "All case data cleared. User accounts preserved."}
