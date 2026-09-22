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
    │   ├── logo.png               # existing sidebar logo (unchanged)
    │   └── logo/nextracelogo.png  # official NexTrace logo asset (login + footer)
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
| Ingestion (admin) | `POST /api/admin/ingestion/upload/{dataset_type}` (dataset files, mode append/replace), `GET /api/admin/ingestion/files`, `DELETE /api/admin/ingestion/{dataset_type}` |
| Processing (admin) | `POST /api/admin/processing/start`, `GET /api/admin/processing/jobs`, `GET /api/admin/processing/jobs/{job_id}` (run + poll pipeline) |
| Entity resolution | `GET /api/entity-resolution`, `POST /api/admin/entity-resolution/{cand_id}/confirm`, `POST /api/admin/entity-resolution/{cand_id}/reject` |
| Graph | `GET /api/graph`, `GET /api/graph/analytics`, `POST /api/graph/path` |
| Timeline | `GET /api/timeline` |
| Evidence | `GET /api/evidence`, `GET /api/evidence/{type}/{id}`, `POST /api/evidence/{type}/{id}/verify`,
  `POST /api/admin/evidence/seal`, biometric register/match |
| Cases | detail, status change, case access, messages, access requests, reports |
| Reports | `POST /api/reports/generate` (PDF) |
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
  Unknown phones/accounts/vehicles become unresolved graph nodes (26 graph nodes on dev data:
  22 resolved persons + 4 unresolved identifiers; 47 typed relationships).

## 12. Network Graph (investigation workspace)

`NetworkGraph.tsx` renders `react-force-graph-2d` over the backend relationship graph and
presents it as an interactive investigation workspace: select → focus → inspect → trace →
verify → explore, without leaving the page.

#### Existing Capabilities

- Interactive graph — force-directed canvas (`react-force-graph-2d` + `d3-force`), zoom / pan /
  drag, node drag-to-pin, fit/reset layout, full-screen mode.
- Typed relationships — edges coloured/weighted by confidence band and labelled by primary type.
- Graph filters — the top toolbar now exposes four dropdown menus (All Entities / All
  Relationships / Min. Confidence / All Communities); choosing an entity subtype, a minimum
  confidence band (e.g. 80%), or a community re-fetches and re-lays-out the filtered subgraph
  live, and "Reset" restores the full graph.
- Entity selection — click a node to select it; click an edge to select the relationship.
- Entity details — name, ID, subtype, case, crime type, connections, community in the panel.
- Entity focus — the search box ("Search a person to focus…") opens a live results dropdown; a
  pick (or a `?focus=<id>` deep link) opens the entity panel and centres/zooms the view on it.
- Confidence/reliability — `ConfidenceBadge` with the actual score and band on edges.
- Community detection — node colour comes from the backend connected-component colouring.
- Bridge entities — dashed-ring "limited view" nodes with an explicit notice (investigator scope).
- Shortest-path analysis — the "Find Path" button opens a Path Analysis panel that computes hops
  via `POST /api/graph/path`.
- Per-entity network view — "Open Full Profile →" links to the Entity Profile page.
- Evidence-linked relationships — each edge carries supporting evidence with record IDs.
- Edge evidence — per-evidence category, score, and examples rendered in the panel.
- Unknown/unresolved identifiers — phone/account/vehicle placeholders drawn as labelled boxes.
- Existing graph analytics — nodes/relationships/communities/density, central (degree) entities,
  bridge (betweenness-ranked) entities.

#### Dynamic Interaction Improvements

- Node focus behaviour — clicking a node, picking a search result, or opening `?focus=<id>`
  centres and zooms the view on that node (300 ms animation) and rings it in cyan.
- Connected-node highlighting — the selected node's direct neighbours are emphasised.
- Unrelated-node de-emphasis — non-neighbours are dimmed (still visible); their incident edges
  are muted too, so the connected neighbourhood stays readable.
- Entity context panel — a right-side overlay panel (entity details, relationship detail, Graph
  Analytics, or Path Analysis, depending on what was opened) slides in over the graph; the
  graph stays dominant and fully selectable. The panel has a fixed width of 420 px.
- Panel open/close behaviour — opens on node/edge selection, search focus, the "Analytics" or
  "Find Path" buttons; closes via the panel's ✕ button (`aria-label="Close panel"`), the Escape
  key, or a click on the graph background. The closed panel is hidden from keyboard focus.
- Dynamic panel updates — each new selection updates the panel in place (keyed 300 ms re-slide),
  with no page reload or navigation.
- Edge selection — clicking any edge replaces the panel content with the relationship detail and
  highlights that edge in the graph.
- Relationship inspection — endpoints, primary type, confidence badge, and edge label.
- Evidence inspection — each supporting-evidence item shows its category label, contribution
  score, and concrete example strings.
- Provenance inspection — record-ID chips link straight to `/evidence?evidence_type=…&id=…` for
  the raw source record (CDR / Financial / CCTV / Report / biometric).
- Confidence display — edge colour (High/Medium/Low), edge width, `ConfidenceBadge`, and a
  hover tooltip (type · confidence %) use only the backend's actual `confidence` values.
- Community interaction — nodes are coloured by the backend community id (legend swatches in the
  on-canvas legend); isolated nodes render grey with a note in the legend.
- Bridge entity interaction — bridge nodes keep their dashed purple ring, the "Limited view"
  notice appears when an investigator focuses one, and the option is explained in the legend.
- Shortest-path interaction — "Find Path →" opens the Path Analysis panel with From/To person
  selects, runs `POST /api/graph/path`, and lists the hops with type and confidence.
- Filter behaviour — dropdown menu picks (entity type / min. confidence / community) trigger the
  engine to re-fetch and re-layout the filtered subgraph; the stats strip and selection react
  accordingly, and "Reset" restores everything.
- Responsive behaviour — the top toolbar collapses into wrapping chips; the overlay panel stays
  at 380 px over the graph (never pushes it); the graph shell fills the available workspace at
  every measured viewport (1920×1080, 1600×900, 1440×900, 1366×768, 1280×720); full-screen mode
  is supported and re-measures the canvas.
- Animation/transition behaviour — panel open/close 300 ms transition, per-selection 300 ms
  slide-in keyframes (`translateX(24px) → 0` + fade), 300 ms node centring, edge hover
  highlight (cyan, widened) with a floating tooltip.

#### Visual Redesign (composition & presentation)

Frontend-only visual overhaul of the graph workspace — all behaviour, data sources and
interactions are unchanged:

- Muted multi-hue community palette — person nodes are tinted with a muted, desaturated family
  (soft blue / teal / indigo / slate / amber / sage / orchid / jade) so clusters read as groups
  without a rainbow effect; the on-canvas legend describes them.
- Person nodes — soft glass body (translucent community tint + stroke + inner core dot) with a
  distant halo; size scales with degree; first-name labels sit on subtle pill backdrops.
- Unresolved identifiers — styled bordered chips (phone / account / vehicle colour-coded by
  subtype) with the raw value inside.
- Selection & focus emphasis — the selected node gets an accent (cyan) ring + halo + trimmed
  label, its direct neighbours get a faint cyan ring, unrelated nodes and edges dim; no pulsing
  animations.
- Edge presentation — toned-down base alphas (the High/Medium/Low colour band still applies),
  thinner default widths, subtle link curvature, and concise uppercase mid-edge tokens
  (CALLED / TRANSFERRED / SEEN TOGETHER / MENTIONED / CO-ACCUSED / SAME ADDRESS /
  SHARED VEHICLE / COLLEAGUE / ASSOCIATED). Edge labels hide when zoomed far out and appear as
  prominent cyan pills for hovered/selected edges.
- Technical backdrop — a subtle ruled grid, a soft accent glow (deepens while a selection or the
  context panel is open) and a strong vignette render above the canvas and below the controls;
  every overlay layer is `pointer-events: none` so graph interaction is fully unaffected.
- Composed layout — the force layout is retuned (stronger repulsion, longer link distance,
  collision padding, milder centre pull) and the graph auto-fits the viewport once on load.
- Reference layout (composition & presentation) — a top toolbar carries the brand
  ("Network Analysis"), four filter dropdowns, Reset / Find Path / Analytics / Fullscreen
  buttons, and the live entity search box; a stats strip below shows Nodes / Relationships /
  Communities / Bridge Entities straight from the analytics endpoint; and on-canvas glass
  sub-controls hold the minimap, the Entity Type + Relationship + "node colour = community"
  legend, and the zoom in / zoom out / fit cluster (all overlay layers are `pointer-events:
  none` so graph interaction is fully unaffected).
- Viewport fitting — the Network Graph route runs as a zero-scroll investigation workspace: the
  app shell reserves 64 px for the global header and the compact 36 px footer, and the page fills
  the space between them (no page-level vertical/horizontal scrollbars) at every measured
  viewport (1920×1080, 1600×900, 1440×900, 1366×768, 1280×720).
- Canvas sizing fix — the `ResizeObserver` that drives canvas width/height is now armed once the
  graph loads, so the canvas always fills the graph shell (previously it could stay at the
  800×600 default and overflow the shell).

#### Viewport / Layout Refinement (this capture)

Layout-only refinement of the approved graph — no visual or functional redesign:

- Page-level branding removed — the graph page carries no large "Network Analysis" title or
  subtitle; only the small "Network Analysis" toolbar chip remains. The empty-state heading and
  the 64 px global app header are unchanged.
- Zero-scroll workspace — on the `/network` route the app shell column is exactly `100dvh` tall
  with `overflow: hidden` and the `<main>` page padding is removed, so the graph page renders
  with no page-level vertical or horizontal scrolling; all other pages keep their normal
  scrolling behaviour (no global `body` overflow rules are added).
- Full-height flex column — the Network Graph page is `height: 100%` over a `flex-1 min-h-0`
  column; the toolbar and stats strip stay compact at the top, and the graph shell (`flex-1
  min-h-0`) absorbs all remaining vertical space.
- Dynamic resize — the existing `ResizeObserver` on the graph shell feeds the canvas
  width/height; the canvas re-measures when the browser window resizes, the sidebar
  opens/collapses (padding-left transition), and fullscreen toggles, without resetting or
  reheating the force simulation or changing its parameters.
- Overlay entity panel — the right-side panel remains an overlay (absolute, 380 px, internal
  scroll) above the graph, width `min(380px, calc(100% - 24px))`; it never shrinks the graph.
- Compact footer — the global footer is reduced to a single 36 px row ("NexTrace | AI-Powered
  Criminal Network Analysis System | Data. Intelligence. Safer Communities." left, SIH 2026
  Prototype badge right); the Quick Links / Platform Info / "INVESTIGATE CONNECT SECURE"
  columns and the bottom bar were removed.

#### Backend/API Changes

Network Graph redesign implemented using existing backend/API capabilities; no new backend
intelligence functionality was introduced.

#### Data Sources

- entities — `GET /api/graph` nodes (id, name, subtype, degree, community, isolated, access_level).
- relationships — `GET /api/graph` edges (source, target, confidence, confidence_band,
  primary_type, evidence[]).
- confidence — edge `confidence` + `analysis.confidence_band` (High ≥ 70, Medium ≥ 40, else Low).
- communities — node `community` from connected components (`analysis.graph_communities`).
- bridge entities — node `access_level: "bridge"` (per-user scope) and the top bridge list from
  `GET /api/graph/analytics` (betweenness-ranked).
- evidence — `edge.evidence[]` (category, label, score, examples, record_ids).
- provenance — record chips open `GET /api/evidence/{type}/{id}`.
- shortest path — `POST /api/graph/path` (networkx `shortest_path`).
- graph analytics — `GET /api/graph/analytics`.

#### Features NOT Implemented

- Heatmap — NOT IMPLEMENTED.
- Temporal/activity graph UI — NOT IMPLEMENTED.
- Unsupported AI prediction metrics — NOT IMPLEMENTED.
- Fake threat/risk scores — NOT IMPLEMENTED.
- Unsupported entity attributes — NOT IMPLEMENTED (only fields the entity record actually
  provides are shown; unresolved identifier nodes have no age/address/telephone to display).
- Per-node betweenness in the panel — NOT IMPLEMENTED because the backend exposes betweenness
  only as the bridge top-N ranking, not per-node scores.

#### Testing

- Backend tests executed: `python -m pytest tests -q` → **44 passed, 0 failed** (from `backend/`).
- Frontend build: `npm run build` (`tsc -b && vite build`) → **passes**.
- Network Graph regression + visual audit: puppeteer (headful Chrome, 1440×900) interaction run
  against the live app (admin + investigator scope) → **73/73 checks passed, 0 console errors**.
  Coverage included:
  - Stats strip (4 stats) matching `GET /api/graph/analytics` (nodes/relationships/communities/
    bridges) for both the admin and the scoped investigator view.
  - Toolbar: brand, search placeholder, all four dropdowns, Reset/Find Path/Analytics/Fullscreen.
  - On-canvas minimap (170×118, "Graph minimap" label) rendering graph content; zoom
    in/out/fit cluster; legend with Entity Type + Relationship examples + "node colour =
    community" note; dark background with green/amber/red confidence edge bands present.
  - Search → results dropdown → entity panel opens with correct name, "Direct Relationships"
    rows with confidence/reference tokens, Full Profile CTA, glow/selection layer; ✕ closes.
  - **Edge click on the canvas opens the Relationship panel with evidence cards** (a sweep over
    detected edge-band pixels with a hover-then-click pattern).
  - Analytics panel opens with central + bridge entity lists; Escape closes it.
  - Find Path panel: two populated person selects; path result returns hops.
  - Filters: community dropdown lists communities and filters; Min. Confidence 80% keeps node
    count and measurably reduces link bands; Entity "Person" renders the node set.
  - **Background click on a verified-empty canvas spot closes the open panel.**
  - Fullscreen engage + exit; `?focus=<id>` deep link opens and centres the entity.
  - Investigator scope: 3 nodes / 2 relationships / 2 bridges in the stats; clicking a bridge
    node shows the "Limited view — belongs to another case. Only the connection to yours is
    shown." notice.
  - Viewport geometry: no horizontal overflow, dominant graph shell, minimap + legend inside the
    shell at 1440×900, 1024×768, 900×900, 768×900.
  - Layout refinement pass — zero-scroll verification (no page-level vertical or horizontal
    scrollbars, graph shell fills remaining height, footer never overlaps the graph) at
    1920×1080, 1600×900, 1440×900, 1366×768 and 1280×720; see §35.
- Screenshots from the audit run are preserved for review (`ng-initial`, `ng-entity-panel`,
  `ng-relationship`, `ng-analytics`, `ng-path`, `ng-investigator`, `ng-geo-*`) in the temp
  workspace.
- The temporary puppeteer audit/probe scripts and the `--no-save` `puppeteer-core` install used
  for this verification were removed after the run; no runtime/test dependencies were added.

#### Files Changed

- `frontend/src/pages/NetworkGraph.tsx` — rewritten to the reference layout (top filter toolbar
  + live search + analytics stats strip, on-canvas minimap/legend/zoom cluster, sliding overlay
  panels of 380 px for entity, relationship, analytics and path) over the previously
  redesigned visual treatment (muted multi-hue palette, glass person nodes, identifier chips,
  toned edges with concise tokens, technical grid/vignette/glow backdrop, retuned force layout,
  one-shot auto-fit, viewport-fitting column, canvas-sizing fix); later refined to a zero-scroll
  `height: 100%` flex workspace (the `calc(100dvh - 112px)` column was removed and the graph
  shell is `flex-1 min-h-0`).
- `frontend/src/pages/NetworkGraph.css` — full scoped design system for the workspace
  (toolbar, search, dropdowns, stats strip, minimap, legend, zoom cluster, overlay panels,
  backdrop overlays, glass controls, legend swatches).
- `frontend/src/App.tsx` — route-aware app shell: the `/network` route uses a zero-scroll
  `100dvh` column and removes the `p-6` page padding so the graph workspace gets the full
  viewport; other routes keep their normal padding and scrolling.
- `frontend/src/components/Footer.tsx` — compact 36 px identity footer (single row: identity
  text left, SIH 2026 Prototype badge right); Quick Links, Platform Info and the
  "INVESTIGATE CONNECT SECURE" columns removed.
- `docs/NEXTRACE_PROJECT_STATE.md` — this document.

## 13. Shortest-path analysis

- Backend `POST /api/graph/path` (networkx `shortest_path` over the relationship graph) — used by
  the graph UI's Path Analysis panel to explore links between two named persons.

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
Frontend interaction coverage: puppeteer run of the Network Graph workspace (73 checks, see
§12 — dropdown filters, minimap/legend/zoom cluster, stats strip, overlay panels, edge-click
relationship panel + evidence cards, background-click close, fullscreen, deep link, investigator
limited-view notice), verified pixel bands and viewport geometry checks, and a fresh
`npm run build` pass.

## 32. Build status

`npm run build` (`tsc -b && vite build`) **passes** (latest run, vite 5.4.21, ~517 kB JS /
36.3 kB CSS).
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
  `public/logo/nextracelogo.png` (sidebar logo untouched), sidebar slide animation
  (`translateX(-100%)` + toggle tooltips), compact NexTrace footer (single identity row with the
  SIH 2026 Prototype badge; Quick Links etc. removed). WebAuthn extension point + Login note
  verified in the backend import and frontend build.

## 34. Network Graph interaction workspace (this capture)

Executed against this tree on the live development database (admin scope unless noted):

- **Backend tests:** `python -m pytest tests -q` → **44 passed**.
- **Frontend build:** `npm run build` (`tsc -b && vite build`) → **passes**.
- **Graph API data:** `GET /api/graph` → 26 nodes (22 persons + 4 unresolved identifiers),
  47 edges; investigator scope returns only visible nodes with `access_level: "bridge"`
  limited-view entities; `GET /api/graph/analytics` and `POST /api/graph/path` verified live.
- **Network Graph interaction run (puppeteer, headful Chrome, 73/73):** stats strip matches
  analytics (26/47/4/5 admin, 3/2/2 investigator scope); toolbar (brand, search, four
  dropdowns, Reset/Find Path/Analytics/Fullscreen); minimap (170×118, labelled) renders graph
  content; zoom in/out/fit cluster; legend (Entity Type + Relationship + community note); dark
  canvas with green/amber/red confidence bands; search → entity panel with Direct Relationships
  rows + Full Profile CTA; ✕ closes; **canvas edge click opens the Relationship panel with
  evidence cards**; Analytics panel + central/bridge lists; Escape closes; Find Path panel with
  two populated selects returns hops; community / Min. Confidence 80% / Entity "Person"
  filters apply (confidence filter measurably reduces link bands); **background click on an
  empty canvas spot closes the open panel**; fullscreen engage + exit; `?focus=` deep link
  opens and centres the entity; investigator bridge node shows the "Limited view — belongs to
  another case" notice; zero console errors.
- **Viewport geometry audit (73/73 suite):** no horizontal overflow, dominant graph shell,
  minimap + legend inside the shell at 1440×900, 1024×768, 900×900 and 768×900.
  Full detail in §12.

---

## 35. Network Graph viewport & layout refinement (this capture)

Executed against this tree on the live development database (admin scope unless noted):

- **Backend tests:** `python -m pytest tests -q` → **44 passed**.
- **Frontend build:** `npm run build` (`tsc -b && vite build`) → **passes**.
- **Changes implemented:** removed the hard-coded `calc(100dvh - 112px)` workspace height; the
  `/network` route now renders as a zero-scroll `100dvh` flex workspace (app shell adjusts
  padding/overflow for this route only); the graph shell fills the remaining height
  (`flex-1 min-h-0`); the right entity panel remains a 380 px overlay; the global footer was
  compacted to a single 36 px row with the Quick Links column removed.
- **Viewport probe (puppeteer, headful Chrome):** at 1920×1080, 1600×900, 1440×900, 1366×768 and
  1280×720 — no page-level vertical or horizontal scrollbars (scrollHeight ≤ innerHeight,
  scrollWidth ≤ innerWidth); toolbar and stats strip visible; graph shell fills the remaining
  space; legend and minimap inside the shell; overlay panel opens/closes with internal scroll and
  never shrinks the graph; sidebar open/closed re-measures the canvas; fullscreen engage/exit
  works; footer never overlaps the graph; zero console errors.
- **Graph styling preserved:** node icons/shapes/colors, edge styling, community colors, halos,
  confidence indicators, bridge/unknown-identifier styling, legend, minimap, dark theme, toolbar
  and controls unchanged (layout-only pass; no force-simulation parameters touched).

---

*Status captured against `nextrace` working tree at build time; all claims reflect code and
the development database as actually present, not aspirational behaviour.*