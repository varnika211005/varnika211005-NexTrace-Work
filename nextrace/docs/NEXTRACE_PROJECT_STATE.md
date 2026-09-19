# NexTrace — Project State

AI-Powered Criminal Network Analysis System (SIH 2026 prototype, synthetic/fictional data only).

This document describes the **actual** state of the repository, endpoints, modules, UI and
development database at the time of writing. Status is intentionally honest — anything that is
an extension point, placeholder, prototype or limitation is labelled as such.

---

## 1. Repository structure

```
nextrace/
├── README.md                 # user-facing overview, roles, run steps, verified results
├── .gitignore                # excludes backend/backups, backend/data, __pycache__, *.pyc
├── docs/
│   └── NEXTRACE_PROJECT_STATE.md   # this document
├── sample_dataset/           # 5 synthetic CSV sources (persons, cdr, financial, cctv, reports)
├── backend/
│   ├── requirements.txt      # fastapi, uvicorn, sqlalchemy, networkx, pydantic, PyJWT, fpdf2, pytest, httpx
│   ├── nextrace.db           # development SQLite database (live demo data)
│   ├── backups/              # admin backups: nextrace_backup_<ts>.json.gz (git-ignored)
│   ├── data/                 # ledger append-only mirror: ledger_append_only.jsonl (git-ignored)
│   ├── tests/                # pytest suite (44 tests as of this writing)
│   └── app/
│       ├── main.py           # FastAPI application + all routes + startup (create_all, seed users, genesis)
│       ├── database.py       # SQLAlchemy engine/Session; DATABASE_URL switchable (SQLite default)
│       ├── models.py         # SQLAlchemy models
│       ├── schemas.py        # Pydantic request/response schemas
│       ├── auth.py           # JWT auth, password hashing, role guards, passkey gateway
│       ├── seed.py           # demo user seeding
│       ├── scope.py          # case-scoped access + evidence visibility
│       ├── analysis.py       # entity resolution + relationship generation
│       ├── intelligence.py   # dashboard intelligence/leads
│       ├── reports.py        # case report rendering (PDF via fpdf2)
│       ├── evidence_integrity.py  # SHA-256 sealing/verification + demo tamper tooling
│       ├── ledger.py         # immutable hash-chain ledger adapter (blockchain-ready)
│       ├── biometrics.py     # biometric *evidence* metadata adapter (suspect evidence, honest no-match)
│       ├── webauthn_auth.py  # biometric *user authentication* extension point (WebAuthn/passkeys)
│       └── backup.py         # gzipped JSON manifests of all case data
└── frontend/
    ├── package.json          # react, react-router-dom, d3-force, react-force-graph-2d, tailwind, vite, TS
    ├── vite.config.ts        # dev port 5173, /api proxied to 127.0.0.1:8000
    ├── public/
    │   ├── logo.png                  # existing sidebar logo (unchanged)
    │   └── logo/nextrace-logo.png    # official NexTrace logo asset (footer)
    └── src/
        ├── App.tsx                 # routes + Shell (header/sidebar/footer)
        ├── context/AuthContext.tsx # login state, JWT storage, role helpers
        ├── components/             # Sidebar, Guards, PageHeader, EmptyState
        ├── api/client.ts           # typed API wrapper
        └── pages/                  # Login + workspace pages (below)
```

---

## 2. Backend architecture

- **FastAPI** single app (`app.main:app`) with global CORS (open for demo), SQLite via SQLAlchemy 2.x.
- On import: `Base.metadata.create_all`, `seed.seed_users`, and ledger genesis-block/mirror
  folder ensure — so the app is self-bootstrapping (idempotent).
- Modular: analysis/intelligence/scooping kept out of `main.py`; integrity/ledger/biometric
  backends are separate, replaceable adapters.

## 3. Frontend architecture

- React 18 + TypeScript + Vite SPA, Tailwind (custom `bg`/`panel`/`card`/`accent` theme),
  React Router v6.
- `AuthProvider` gates routes: `ProtectedRoute` (any authenticated user), `AdminRoute`
  (admin_investigator only).
- All data access via `src/api/client.ts` (`get`/`post` helpers carrying the JWT).
- Shell = top header (user + sign-out) + collapsible sidebar + page content + NexTrace footer.

## 4. Data models (SQLAlchemy)

Users, Persons (resolved + unresolved/unknown nodes), CallRecord, FinancialRecord,
CCTVSighting, CaseReport, CaseFile (`cases` table, incl. `status`), Relationship,
EntityResolutionCandidate, ProcessingJob, AuditLog, IngestedFile, CaseAccess,
CaseMessage, PersonAccessGrant, AccessRequest, EvidenceHash, LedgerBlock, SecurityEvent,
CaseStatusHistory, BackupRecord, BiometricEvidence, DemoTamperRecord.

## 5. API endpoints

| Area | Endpoints |
|---|---|
| Health / Auth | `GET /api/health`, `POST /api/auth/login`, `GET /api/auth/me` |
| Ingestion (admin) | `POST /api/admin/ingest/{dataset}`, `POST /api/admin/ingest/upload` (dataset files, mode append/replace) |
| Processing (admin) | `POST /api/admin/processing`, `GET /api/admin/processing` (run + poll pipeline) |
| Entity resolution | `GET/POST /api/admin/resolution/candidates`, confirm/merge actions |
| Graph | `GET /api/network`, `GET /api/network/entity/{id}`, shortest-path, `GET /api/network/categories` |
| Timeline | `GET /api/timeline` |
| Evidence | `GET /api/evidence`, `GET /api/evidence/{type}/{id}`, `POST /api/evidence/{type}/{id}/verify`,
  `POST /api/admin/evidence/seal`, biometric register/match |
| Cases | detail, status change, case access, messages, access requests, reports |
| Reports | `POST /api/admin/reports` (PDF) |
| Audit | `GET /api/admin/audit` |
| User mgmt (admin) | users list/create/update (incl. deactivation), `GET /api/admin/users/{id}/audit` |
| Access control (admin) | case access grants, person grants, access requests |
| Security & integrity (admin) | `GET /api/admin/security`, events list, event ack,
  `POST /api/admin/security/simulate-tamper`, `POST /api/admin/security/restore-tampered-evidence`,
  `GET /api/admin/security/tamper-records` |
| Ledger (admin) | `GET /api/admin/ledger`, `POST /api/admin/ledger/verify` |
| Backup (admin) | `POST /api/admin/backup` (create), `GET .../backups` (list), `GET .../backups/{id}/download` |

## 6. Authentication & role-based access control

- Password: SHA-256 of password stored (demo-grade; not a production KDF).
- Session: JWT (HS256, 12 h expiry) issued at login; bearer token sent by the frontend.
- Roles: `admin_investigator` (full, incl. admin pages) and `investigator` (case-scoped).
  Backend guards `require_admin` on every admin route; direct route hits from an
  investigator return 403 (verified by tests).
- Deactivation: an admin is never locked out; an inactive investigator is blocked at login
  and their existing session is cut off at `get_current_user`.
- **Biometric user authentication**: WebAuthn/passkey path exists only as a clean extension
  point (`webauthn_auth.py` + `auth.authenticate_with_passkey`) and is **not configured** in
  this deployment — it never returns fake success; the password + JWT path is the working
  login. See §24.

## 7. Case-scoped access

- `scope.py` computes each user's visible cases (full access) plus "bridge" access for
  subjects directly linked to their cases (`PersonAccessGrant`).
- Evidence visibility is filtered per endpoint (dashboard, entities, graph, timeline,
  evidence, reports) — enforced backend-side, not just hidden in the UI.

## 8. Ingestion

- 5 dataset types (`persons`, `cdr`, `financial`, `cctv`, `reports`) with expected CSV
  filenames; upload via multipart; modes: append / replace (destructive, warned).
- Every upload is recorded in `IngestedFile` and audit-logged.

## 9. Processing pipeline

- One `ProcessingJob` with ordered stages JSON (incl. a final "seal evidence" stage that
  SHA-256-seals all raw records into `EvidenceHash` + ledger block).
- Stage 8 = evidence sealing; pipeline preserves existing case statuses while syncing.

## 10. Entity resolution

- `analysis.py` builds resolution candidates (phones, accounts, plates, names) with
  similarity + reasons; admins confirm/merge; verified results on the dev dataset:
  7 candidates, top match 95.2% (Arjun Mehta ↔ Arun Mehta duplicate FIR).

## 11. Relationships

- Typed edges with evidence provenance: direct contact (CDR), financial transfer, CCTV
  co-location, mentioned together, co-accused, shared residence/vehicle/colleague.
  Unknown phones/accounts/vehicles become unresolved graph nodes (49 graph nodes on dev data:
  22 resolved persons + unresolved leads).

## 12. Interactive graph

- `NetworkGraph.tsx`: force-directed `react-force-graph-2d`, category-colored, filterable,
  edge click → linked evidence record chips (per evidence category → record ID → detail view).

## 13. Shortest-path analysis

- Backend `GET /api/network/shortest-path` (BFS over the relationship graph) — used by the
  graph UI to explore links between two entities.

## 14. Timeline

- `GET /api/timeline` merges dated evidence (calls, financial, CCTV, reports) chronologically
  for a case/entity.

## 15. Evidence repository

- Sorted list of all evidence (`/api/evidence-list`), detail with integrity status,
  contributes-to relationships, and (for biometrics) honest match-availability flag.

## 16. Reports

- `reports.py` builds a structured case dossier and renders PDF with fpdf2; generated
  reports are returned as downloads and audit-logged.

## 17. Audit log

- `AuditLog` captures user, role, action, resource, case, result (+ timestamp); admin
  audit UI lists/filters it. Nothing removes historical entries.

## 18. Evidence SHA-256 integrity

- `evidence_integrity.py`: canonical deterministic JSON payload per row → SHA-256 →
  `EvidenceHash` (registry) + anchored in ledger. Verify recomputes + compares both sources.
- Sealing skips rows under an Active demo tamper so a tampered value is never silently
  re-anchored. Any modification (including registry tampering) is detected; see
  `test_registry_tampering_still_detected`.

## 19. Immutable ledger (blockchain-ready adapter)

- `ledger.py` `HashChainLedger`: each block has index, timestamp, prev-hash, hash,
  payload; genesis is ensured on startup; app table + append-only JSONL mirror
  (`backend/data/ledger_append_only.jsonl`) as an independent anchor.
- Only SHA-256 hashes + provenance metadata are stored — never raw evidence.
- Dev DB: 2 blocks (genesis + evidence_seal), chain verified valid.
- Honest wording: this is a **blockchain-READY adapter** on SQLite, not a public
  blockchain; no Ganache/Hardhat/Anvil integration.

## 20. Security events

- `SecurityEvent` (type, severity, expected/current hash, case, detected_by/at, status).
  Verification that fails creates/refreshes a permanent Open event; acknowledging marks it
  `Acknowledged` (reviewed) but never deletes it. Acknowledging all Open events returns the
  dashboard to `System Status: Secure`.

## 21. Tamper detection & restoration (demo-only)

- `POST /api/admin/security/simulate-tamper` preserves the original value in
  `DemoTamperRecord`, genuinely alters one sealed record; the next verify reports a real
  violation. `restore-tampered-evidence` restores the exact original.
- **Input normalization (fixed bug)**: simulate/restore/verify/detail now accept either the
  canonical storage key (`call_record`) or the display label (`CDR`) via the single
  centralized `evidence_integrity.normalize_evidence_type()`; `tamper-records` additionally
  returns `evidence_type_label`. The restore path used by the frontend no longer fails with
  "Unknown evidence type." (regression tests cover both forms).
- History is permanent: the SecurityEvent, audit entries and ledger blocks created by the
  demo are never deleted by restore. Dev DB currently holds 2 Reverted tamper records for
  CDR011 (both retained) and 2 Acknowledged events.

## 22. Case status

- `CaseFile.status` in {`Under Investigation`, `Solved`, `Unsolved or Closed`} (seed mixes
  the first two); every change is recorded in `CaseStatusHistory` + audit. Admin or
  Read/Write CaseAccess holders can change status; pipeline preserves custom statuses.
  Dev data: 8 `Under Investigation`, 1 `Solved`.

## 23. Backup & restore

- `backup.py`: gzipped JSON manifest `nextrace_backup_<YYYYMMDD-HHMMSS>.json.gz`, schema
  version `1.0`, written to `backend/backups/` (git-ignored), served back with
  `application/gzip`, each with a SHA-256; tracked in `BackupRecord`.

## 24. Biometric authentication architecture (user login)

- Goal flow: user device → biometric/passkey → WebAuthn assertion → NexTrace auth gateway →
  JWT → dashboard.
- Current state (honest): `webauthn_auth.py` defines a `WebAuthnAuthBackend` interface +
  `UnavailableWebAuthnBackend` + registry, and `auth.authenticate_with_passkey(db, ...)`
  raises 501 until a real relying party (e.g. py_webauthn) is registered. It never returns
  fake success; no template/credential data is stored; the Login page states clearly that
  biometric/passkey sign-in is not configured here.
- Separate concern: `biometrics.py` remains the **suspect biometric-evidence** metadata
  adapter (who/when/modality provenance only, never faked match scores).

## 25. Pages (frontend)

Login · Dashboard · Entities · Entity Profile · Network Graph · Timeline · Evidence ·
Cases · Case Detail · Entity Resolution · Access Requests · Reports · Profile;
admin pages: Data Ingestion, Processing Pipeline, Audit & Provenance, User Management,
Access Control, Security & Integrity (live posture + demo tamper tool), Backup & Restore.

## 26. Dev commands

```
# Backend (port 8000)
cd backend
python -m venv venv            # one-time
venv\Scripts\activate          # PowerShell on Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Tests (from backend/)
python -m pytest tests -q      # 44 passed at time of writing

# Frontend (port 5173, /api proxied to 127.0.0.1:8000)
cd frontend
npm install
npm run dev
npm run build                  # tsc -b && vite build (passes)
```
Demo logins: `ADMIN01`/`admin123` (admin), `INV204`/`investigator123` (investigator).

## 27. Ports

- Backend API + docs: http://127.0.0.1:8000/docs
- Frontend dev: http://localhost:5173
- frontend dev server proxies `/api` → 127.0.0.1:8000 (vite.config.ts).

## 28. Architecture decisions (recorded)

- SQLite default, DATABASE_URL-swappable to PostgreSQL without code change.
- SHA-256 + immutable chain rather than a public chain dependency.
- Pipeline final stage seals evidence so the "tamper-proof" claim is testable.
- Status-preserving case sync in processing (no overwrite of custom statuses).
- Honest placeholders: no fake biometric matching, no fake blockchain storage, no fake
  passkey success.

## 29. Not implemented / explicitly out of scope

- Real WebAuthn relying party (extension point only).
- Real biometric matching engine (metadata provenance only).
- Production password hashing (PBKDF2/argon2), TLS termination, secret management.
- Multi-node/public blockchain deployment (app-side adapter only).
- Encryption at rest (labelled N/A for the local demo database).
- Real SMS/email delivery for access notifications.

## 30. Limitations

- Demo-grade secrets (`nextrace-demo-secret…`) — must be replaced for any real use.
- SHA-256 password hashing is intentionally simple for a prototype.
- Backup manifest covers case data (persons, evidence, cases, relationships/audit-ish); full
  DB snapshot not included.
- CORS wide open for the demo.

## 31. Testing status

`python -m pytest tests -q` → **44 passed** (latest run). Coverage areas: auth & RBAC
(admin/investigator/deactivation), integrity full cycle (seal → verify → tamper → violation →
restore → verify), canonical-key vs label restore regression, registry tampering detection,
ledger chain validity, case status + pipeline preservation, backup create/list/download
+ gzip JSON schema, biometric endpoints, report generation, access control smoke tests.

## 32. Build status

`npm run build` (`tsc -b && vite build`) **passes** (latest run, vite 5.4.21, ~501 kB JS chunk).
Live dev DB state after the tamper demo: system `Secure`, ledger chain valid (2 blocks),
CDR011 restored to its true original 240 with full tamper/restore history retained.

## 33. Final verification run (this capture)

Executed against this tree on the live development database:

- **Backend tests:** `python -m pytest tests -q` → **44 passed**.
- **Frontend build:** `npm run build` (`tsc -b && vite build`) → **passes**.
- **CDR011 tamper-restore cycle (16/16 checks):** simulate → verify = INTEGRITY VIOLATION →
  restore original (240) → verify = INTEGRITY VERIFIED, using canonical keys throughout;
  `DemoTamperRecord` rows retained as `Reverted`, SecurityEvents retained (acknowledged),
  audit trail intact, ledger chain valid (2 blocks), system posture `Secure`.
- **Route walkthrough (21/21):** evidence list/detail (label + canonical), verify, entities,
  graph (26 nodes / 47 edges) + analytics, timeline, cases, case detail/status guard, dashboard,
  security status, ledger view/verify, audit, backup list, biometric evidence endpoints,
  security events, tamper-records (with `evidence_type_label`).
- UI refinements verified in build: official NexTrace logo added at
  `public/logo/nextrace-logo.png` (sidebar logo untouched), sidebar slide animation
  (`translateX(-100%)` + toggle tooltips), NexTrace footer (identity, quick links, platform
  info, "INVESTIGATE CONNECT SECURE", SIH 2026 bottom strip). WebAuthn extension point +
  Login note verified in the backend import and frontend build.

---

*Status captured against `nextrace` working tree at build time; all claims reflect code and
the development database as actually present, not aspirational behaviour.*