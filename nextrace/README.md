# NexTrace — AI-Powered Criminal Network Analysis System

A full investigative-intelligence platform: ingest multiple evidence sources (case
records, call logs, financial transactions, CCTV metadata, investigation reports),
automatically resolve people across them, detect hidden relationships with
**explainable confidence scores and full provenance**, and explore it all through
a role-based investigation workspace with a typed, interactive network graph.

Built entirely on **synthetic/fictional data**. No real individuals are represented.

---

## 1. Core idea

```
5 EVIDENCE SOURCES  →  ENTITY RESOLUTION  →  EVIDENCE-LINKED RELATIONSHIP GRAPH
   (calls, money,        (phones, accounts,      →  GRAPH / TEMPORAL ANALYSIS
    CCTV, reports,        plates, names)          →  EXPLAINABLE INVESTIGATIVE INSIGHT
    case files)                                   →  HUMAN VERIFICATION
```

This is a **decision-support tool**, not an automated guilt-determination system.
Every relationship is traceable to the exact source records that produced it, and
language throughout avoids "criminal"/"guilty" in favor of "Person of Interest,"
"Investigative Lead," and "Potential Association."

---

## 2. What makes the graph "detailed" (not just dots connected by lines)

Every relationship in the graph is one of these **typed, evidence-backed** categories,
and every edge shows *exactly which raw records* produced it:

| Type | Source | Example |
|---|---|---|
| **Direct Contact (Call/SMS)** | Call Detail Records | "3 calls totaling 14m between 987... and 998..." |
| **Financial Transfer** | Bank transaction logs | "NEFT of ₹85,000, ACC10001 → ACC10002" |
| **Co-located (CCTV)** | Camera sighting metadata | "Both observed at Jayanagar Market within 10 min" |
| **Mentioned Together in Report** | FIR/investigation report text | "Both named in report RPT004" |
| **Co-Accused (Same Case)** | Case file field | Shared case ID |
| **Shared Residence/Location, Shared Vehicle, Colleague, Reported Association** | Case file fields | Address, vehicle plate, organization, notes-mentions |

Phone numbers, bank accounts, and vehicle plates that appear in evidence but don't
match any known subject are **not discarded** — they become "Unknown Phone/Account/
Vehicle" nodes in the graph, flagged for further identification (a real investigative
concept: the burner phone or mule account lead).

---

## 3. Roles

Two roles, one shared platform — **the backend enforces this, not just the UI**:

- **Investigator** — sees the full dashboard, entities, network, timeline, evidence,
  cases, and reports experience, but **only for cases they've been assigned to**
  (see §4 below) — and cannot ingest data, run processing, confirm entity matches,
  or access admin pages.
- **Admin Investigator** — sees everything, unrestricted, plus Data Ingestion,
  Processing Pipeline, Entity Resolution actions, Audit & Provenance, User
  Management, Access Control, and Security.

Login does **not** ask which role you are — the backend looks it up and renders
the right interface. An Investigator hitting an admin API route directly gets a
`403 Forbidden`, verified in testing.

**Demo credentials:**
| Analyst ID | Password | Role |
|---|---|---|
| `ADMIN01` | `admin123` | Admin Investigator |
| `INV204` | `investigator123` | Investigator |

---

## 4. Case-scoped access, collaboration, and access requests

An Investigator only sees data connected to the case(s) an Admin has assigned
them to (Administration → Access Control) — not the whole dataset. This is
enforced on the backend across every endpoint (dashboard, entities, graph,
timeline, evidence, cases, reports), not just hidden in the UI.

**Two levels of visibility:**
- **Full access** — every subject in a case the Investigator is assigned to:
  complete profile, evidence, timeline, all relationships.
- **Limited ("bridge") access** — a subject *outside* their assigned case(s) who
  has a direct relationship to someone in their case. Only that specific
  connection is visible (who, how, what evidence) — not the other subject's full
  profile, notes, or unrelated relationships. This is what lets an Investigator
  notice "this case touches another case" without that other case's data being
  exposed to them.

**Multiple Investigators per case:** assign the same case to more than one
Investigator from Access Control — there's no limit. Everyone assigned to a case
shares a **Case Discussion** thread on that case's detail page, so co-assigned
Investigators can coordinate leads without leaving the app.

**Access Requests:** if an Investigator needs a case or a specific subject outside
their assignment, a **Request Access** button appears automatically wherever they
hit that boundary (a restricted profile, a limited graph node, a 403 on a case).
They can also file a general request from the **Access Requests** page. Every
Admin Investigator sees pending requests there and can Approve (which immediately
grants the access) or Deny, with an optional note either way.

---

## 5. Tech stack

- **Frontend:** React + TypeScript + Vite, Tailwind CSS (dark theme), `react-force-graph-2d`
- **Backend:** Python + FastAPI, JWT auth (PyJWT)
- **Database:** SQLite by default (zero setup). Postgres-compatible via one env var — see §9.
- **Graph analytics:** NetworkX (communities, betweenness centrality, shortest path)
- **Reports:** Server-generated PDF via `fpdf2`

---

## 6. Project structure

```
nextrace/
├── backend/
│   ├── app/
│   │   ├── main.py           # All API routes
│   │   ├── analysis.py       # Multi-source relationship detection engine (core logic)
│   │   ├── scope.py          # Case-scoped access control - what each Investigator can see
│   │   ├── intelligence.py   # Summaries, reliability scoring, pattern indicators
│   │   ├── reports.py        # PDF report generation
│   │   ├── auth.py           # JWT + password hashing + role dependencies
│   │   ├── models.py         # Database tables
│   │   └── seed.py           # Creates the two demo user accounts
│   └── requirements.txt
├── frontend/
│   ├── public/logo.png
│   └── src/
│       ├── pages/            # Dashboard, Entities, EntityProfile, NetworkGraph, Timeline,
│       │                       Evidence, Cases, CaseDetail, EntityResolution, Reports,
│       │                       Profile, AccessRequests
│       ├── pages/admin/      # Ingestion, Processing, Audit, Users, AccessControl, Security
│       ├── components/       # Sidebar, Guards, ConfidenceBadge, Badge, PageHeader,
│       │                       EmptyState, RequestAccessButton
│       ├── context/           # AuthContext
│       └── api/client.ts     # Typed API client
├── sample_dataset/
│   ├── persons.csv               # 22 fictional subjects (master case records)
│   ├── cdr_records.csv           # 28 call/SMS records
│   ├── financial_records.csv     # 17 bank transactions
│   ├── cctv_sightings.csv        # 14 camera sighting records
│   └── investigation_reports.csv # 9 FIR/report narratives
└── README.md
```

---

## 7. Step-by-step: run the project

### Prerequisites
Python 3.10+, Node.js 18+

### Step 1 — Start the backend
```bash
cd nextrace/backend
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
Confirm it's running at **http://127.0.0.1:8000/docs**. Two demo user accounts
are created automatically on first run.

### Step 2 — Start the frontend (new terminal)
```bash
cd nextrace/frontend
npm install
npm run dev
```
Open **http://localhost:5173**. The dev server proxies `/api` to the backend
automatically.

### Step 3 — Walk through the demo
1. **Sign in** as `ADMIN01` / `admin123`.
2. Go to **Data Ingestion** and upload all five files from `sample_dataset/`
   (one card per file — `persons.csv`, `cdr_records.csv`, `financial_records.csv`,
   `cctv_sightings.csv`, `investigation_reports.csv`).
3. Go to **Processing Pipeline** and click **Start Processing** — watch the 7
   stages complete live (entity extraction, entity resolution, relationship/graph
   construction, graph analytics, pattern analysis).
4. Explore **Dashboard**, **Network**, **Entities**, **Cases**, **Timeline**,
   **Evidence**, **Entity Resolution**, and **Reports**.
5. Sign out and sign in as `INV204` / `investigator123` to see the read-only,
   non-admin experience — the Administration section disappears from the sidebar
   entirely, and admin API routes return 403 if hit directly.

### Adding new data later (daily ingestion)

Data Ingestion defaults to **"Add to existing data"** — uploading a new CSV adds
any new records and updates any record whose `id` already exists, without
touching anything else already in the database. This is what real usage needs:
today's new call log adds to yesterday's instead of erasing it, and the network
grows over time as more evidence comes in. You can also select multiple files at
once in a single card (e.g. several days' worth of CDR exports) and they'll be
processed in sequence.

**"Replace entire dataset"** is available as an explicit, separate option on each
card (with a warning before it runs) for when you genuinely want to wipe that
data type and start over — e.g. correcting a bad import.

Either way, **relationships aren't recomputed automatically** — after adding new
data, go to Processing Pipeline and click Start Processing again to rebuild the
graph across the combined old + new data.

---

## 8. How confidence scoring works (ground truth)

Every pair of resolved entities is scored per evidence category, summed and
capped at 100:

| Category | Base score | Scales with |
|---|---|---|
| Call / SMS | 25 (+5/extra call, cap 50) | number of calls |
| Financial Transfer | 25 (+7/extra tx, cap 45) | number of transactions |
| CCTV Co-location | 20 (+10/extra sighting, cap 35) | number of co-located sightings |
| Mentioned Together in Report | 20 (+10/extra report, cap 30) | number of reports |
| Same Case | 25 flat | — |
| Shared Address | 20 flat | — |
| Shared Vehicle | 18 flat | — |
| Colleague (shared org) | 12 flat | — |
| Reported Association (notes mention) | 15 flat | — |

**Bands:** High ≥ 70% · Medium 40–69% · Low < 40%

The relationship's displayed "type" is the single category with the highest
individual score. Every score is fully traceable — click any relationship in the
app to see the exact evidence records (call IDs, transaction IDs, sighting IDs,
report IDs) that produced it.

Per-subject **Reliability** on the Dashboard/Entity Profile is a separate,
person-level score averaging five components: evidence strength, source
diversity (how many of the 5 evidence types corroborate this person's links),
entity-resolution status, temporal consistency, and the proportion of
high-confidence relationships.

---

## 9. Verified results (actually run against this exact codebase and dataset)

After uploading all 5 files and running the processing pipeline:

- **22 entities** (including 1 duplicate-record test case) → **26 graph nodes**
  after adding 4 auto-detected unresolved identifiers (2 unknown phone numbers,
  1 unknown account, 1 unidentified vehicle plate)
- **47 relationships detected** — 17 High / 6 Medium / 24 Low confidence
- **4 communities**, **1 fully isolated entity** (Ishaan Bose — no links found anywhere)
- **Most connected subject:** Arjun Mehta (8 connections) — also flagged as a Bridge Entity
- **7 entity-resolution candidates** generated, topped by a 95.2% match between
  "Arjun Mehta" and a duplicate FIR entry filed as "Arun Mehta"

### The single best thing to try first
Open **Rohit Malhotra**'s profile → Relationships tab → his link to **Sanjay
Kulkarni**. These two are in *completely different cases* (Money Laundering vs.
Illegal Betting) — yet the system finds **three independent, cross-corroborating
evidence types** linking them: a phone call (CDR020), a ₹40,000 bank transfer
(FIN012), and an investigation report that names them together (RPT009). That's
a 70% "High" confidence, cross-case bridge — surfaced automatically, not manually
spotted. It also shows up on the **Dashboard** as a "Potential Coordinated Activity
Across Cases" indicator.

Other good demo moments:
- **Karan Verma** and **Farhan Ali**'s case notes both explicitly say "no known
  associates" — yet both have real, evidence-backed connections the system found anyway.
- **Case NX-0655** (the betting ring: Sanjay/Meenal/Imran) is discoverable almost
  entirely through calls and financial transfers, not case-file field overlap —
  proving the multi-source engine adds value beyond simple profile matching.
- The **Network Graph** page: filter by relationship type (uncheck everything
  except "Financial Transfer") to watch the graph reshape to show only money flows.

### Case-scoped access, tested end-to-end
As `ADMIN01`, assign case `NX-0241` to `INV204` (Access Control), then log in as
`INV204`:
- **Dashboard** correctly restricts to **6 full-access subjects** (Arjun Mehta,
  Ravi Sharma, Priya Nair, Rahul Kapoor, Sneha Joshi, and the duplicate "Arun
  Mehta" record) with **15 relationships**, not the full 47.
- **Entities list** shows those 6 as full access, plus **4 more** (Neha Rao,
  Suresh Iyer, Manoj Pillai, Rohit Malhotra) tagged **"Limited View"** — each
  connected to the case through a real relationship, but nothing else about them
  exposed.
- Opening a Limited View subject (e.g. Neha Rao) shows only the specific
  relationships tying her back into NX-0241 — no phone, notes, evidence, or
  timeline.
- Opening a subject with **zero** connection to NX-0241 (e.g. the fully isolated
  Ishaan Bose) correctly returns "Access Restricted" with a **Request Access**
  button.
- Filing a person-access request for Neha Rao, then approving it as `ADMIN01`,
  immediately upgrades her from Limited to full access on `INV204`'s next page
  load — no re-login needed.

---

## 10. (Optional) Switch to PostgreSQL

```bash
createdb nextrace
export DATABASE_URL="postgresql://<user>:<password>@localhost:5432/nextrace"
pip install psycopg2-binary
uvicorn app.main:app --reload --port 8000
```
No code changes needed — `backend/app/database.py` reads this automatically.

---

## 11. Extending this further

- **More evidence sources:** add a new upload type + extend `analysis.py`'s
  evidence categories the same way CDR/Financial/CCTV/Reports were added.
- **Real NLP name extraction:** the "mentioned in report" detector is currently
  regex-based word-boundary matching; swap in spaCy NER without touching anything else.
- **Real entity-resolution merging:** "Confirm Match" currently marks status only
  (non-destructive, reversible) rather than merging records — intentional for a
  demo; wire up an actual merge operation when ready for production use.
- **Case management depth:** case status transitions, manual analyst notes, and
  finer-grained access levels are natural next additions on top of the existing
  `CaseFile` / `CaseAccess` tables.

---

## 12. Important framing note

This is a decision-support prototype using **entirely fictional data**. Confidence
scores and "reliability" reflect the strength and consistency of available
evidence and record matching — they are investigative leads, not proof of guilt.
This principle is reflected in the UI copy, the generated PDF reports (which carry
an explicit disclaimer), and the entity-resolution workflow (AI proposes, a human
confirms or rejects).