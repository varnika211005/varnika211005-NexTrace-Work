import json
import os
from datetime import datetime

from fpdf import FPDF

from . import models, analysis, intelligence

REPORTS_DIR = os.path.join(os.path.dirname(__file__), "..", "generated_reports")
os.makedirs(REPORTS_DIR, exist_ok=True)

DISCLAIMER = (
    "Automated analysis provides investigative leads and evidence organization. "
    "It does not independently establish guilt or culpability. All confidence scores "
    "reflect the strength and consistency of available evidence and record matching."
)


def build_report_content(db, case_id, person_id, sections, generated_by):
    persons_q = db.query(models.Person).filter(models.Person.is_unresolved == False)
    if case_id:
        subjects = persons_q.filter(models.Person.case_id == case_id).all()
        title = f"Investigation Report — Case {case_id}"
    elif person_id:
        p = db.query(models.Person).get(person_id)
        subjects = [p] if p else []
        title = f"Subject Report — {p.name if p else person_id}"
    else:
        subjects = persons_q.all()
        title = "Full Dataset Investigation Report"

    G = analysis.build_graph(db)
    pending_ids = {c.person_a_id for c in db.query(models.EntityResolutionCandidate)
                   .filter(models.EntityResolutionCandidate.status == "Pending")} | \
                  {c.person_b_id for c in db.query(models.EntityResolutionCandidate)
                   .filter(models.EntityResolutionCandidate.status == "Pending")}

    content = {"title": title, "generated_at": datetime.utcnow().isoformat(), "generated_by": generated_by, "sections": {}}

    subject_blocks = []
    all_rels = []
    for p in subjects:
        rels = intelligence._relationships_for(db, p.id)
        all_rels.extend(rels)
        reliability = intelligence.compute_reliability(db, p, rels, pending_ids)
        summary = intelligence.generate_entity_summary(p, rels, G)
        subject_blocks.append({
            "person": p, "relationships": rels, "reliability": reliability, "summary": summary,
        })

    if "executive_summary" in sections:
        n_high = sum(1 for r in all_rels if r["confidence"] >= 70)
        content["sections"]["executive_summary"] = (
            f"This report covers {len(subjects)} subject(s) and {len(all_rels)} detected relationship "
            f"record(s) (counted per subject), of which {n_high} are high-confidence. All findings are "
            f"investigative leads derived from cross-source evidence correlation and require human "
            f"verification before any action is taken."
        )

    if "subject_profile" in sections:
        content["sections"]["subject_profile"] = subject_blocks

    if "network_overview" in sections:
        ids = {p.id for p in subjects}
        edges = [e for e in db.query(models.Relationship).all() if e.source_id in ids or e.target_id in ids]
        content["sections"]["network_overview"] = {
            "subjects": len(subjects), "relationships": len(edges),
            "communities": len(set(analysis.graph_communities(G).values())) if G.number_of_nodes() else 0,
        }

    if "relationships" in sections:
        content["sections"]["relationships"] = all_rels

    if "evidence" in sections:
        evidence_items = []
        for r in all_rels:
            evidence_items.extend(r["evidence"])
        content["sections"]["evidence"] = evidence_items

    if "reliability" in sections:
        content["sections"]["reliability"] = [
            {"name": b["person"].name, **b["reliability"]} for b in subject_blocks
        ]

    if "pattern_findings" in sections:
        content["sections"]["pattern_findings"] = intelligence.generate_intelligence_indicators(db, G)

    if "provenance" in sections:
        content["sections"]["provenance"] = (
            "Every relationship above is traceable to specific source records (call detail records, "
            "financial transaction logs, CCTV sighting metadata, or investigation report narratives). "
            "Use the Evidence Repository in the application to inspect raw source rows."
        )

    return content


def _clean(text) -> str:
    """fpdf2's core Helvetica font is Latin-1 only; swap common unicode punctuation for ASCII."""
    if text is None:
        return ""
    text = str(text)
    replacements = {
        "—": "-", "–": "-", "…": "...", "\u2018": "'", "\u2019": "'",
        "\u201c": '"', "\u201d": '"', "₹": "Rs. ", "→": "->", "↔": "<->",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return text.encode("latin-1", "replace").decode("latin-1")


def render_pdf(content: dict) -> str:
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    _orig_multi_cell = pdf.multi_cell

    def _safe_multi_cell(w, h, text="", *a, **kw):
        pdf.set_x(pdf.l_margin)
        return _orig_multi_cell(w, h, _clean(text), *a, **kw)

    pdf.multi_cell = _safe_multi_cell

    pdf.set_font("Helvetica", "B", 16)
    pdf.multi_cell(0, 10, content["title"])
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(120, 120, 120)
    pdf.multi_cell(0, 6, f"Generated {content['generated_at']} UTC by {content['generated_by']}")
    pdf.set_text_color(0, 0, 0)
    pdf.ln(4)

    def heading(text):
        pdf.set_font("Helvetica", "B", 12)
        pdf.ln(3)
        pdf.multi_cell(0, 8, text)
        pdf.set_font("Helvetica", "", 10)

    sections = content["sections"]

    if "executive_summary" in sections:
        heading("Executive Summary")
        pdf.multi_cell(0, 6, sections["executive_summary"])

    if "subject_profile" in sections:
        heading("Subject Profiles")
        for block in sections["subject_profile"]:
            p = block["person"]
            pdf.set_font("Helvetica", "B", 10)
            pdf.multi_cell(0, 6, f"{p.name}  ({p.id})")
            pdf.set_font("Helvetica", "", 9)
            pdf.multi_cell(0, 5, f"Case: {p.case_id or 'N/A'}  |  Crime type: {p.crime_type or 'N/A'}  |  "
                                  f"Status: {p.status or 'N/A'}")
            pdf.multi_cell(0, 5, f"Age: {p.age or '-'}  Phone: {p.phone or '-'}  Address: {p.address or '-'}")
            pdf.multi_cell(0, 5, f"Reliability: {block['reliability']['overall']}%")
            pdf.multi_cell(0, 5, block["summary"])
            pdf.ln(2)

    if "network_overview" in sections:
        heading("Network Overview")
        ov = sections["network_overview"]
        pdf.multi_cell(0, 6, f"Subjects: {ov['subjects']}   Relationships: {ov['relationships']}   "
                              f"Communities: {ov['communities']}")

    if "relationships" in sections:
        heading("Significant Relationships")
        seen = set()
        for r in sections["relationships"]:
            key = tuple(sorted([r["source_id"], r["target_id"]]))
            if key in seen:
                continue
            seen.add(key)
            pdf.set_font("Helvetica", "B", 9)
            pdf.multi_cell(0, 5, f"{r['source_id']} <-> {r['target_id']}  ({r['confidence']:.0f}% {r['confidence_band']})")
            pdf.set_font("Helvetica", "", 9)
            pdf.multi_cell(0, 5, f"Type: {r['primary_type']}")
            for e in r["evidence"][:4]:
                pdf.multi_cell(0, 5, f"  - {e['label']}: {e['count']} record(s)")
            pdf.ln(1)

    if "reliability" in sections:
        heading("Reliability / Confidence Analysis")
        for row in sections["reliability"]:
            pdf.multi_cell(0, 5, f"{row['name']}: {row['overall']}% overall  |  "
                                  f"Evidence {row['components']['evidence_strength']}%, "
                                  f"Source diversity {row['components']['source_reliability']}%, "
                                  f"Temporal {row['components']['temporal_consistency']}%")

    if "pattern_findings" in sections:
        heading("Potential Pattern Findings")
        for ind in sections["pattern_findings"]:
            pdf.set_font("Helvetica", "B", 9)
            pdf.multi_cell(0, 5, f"[{ind['severity']}] {ind['title']}")
            pdf.set_font("Helvetica", "", 9)
            pdf.multi_cell(0, 5, ind["explanation"])
            pdf.ln(1)

    if "provenance" in sections:
        heading("Provenance")
        pdf.multi_cell(0, 6, sections["provenance"])

    pdf.ln(6)
    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(150, 60, 60)
    pdf.multi_cell(0, 5, DISCLAIMER)

    filename = f"NexTrace_Report_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}.pdf"
    path = os.path.join(REPORTS_DIR, filename)
    pdf.output(path)
    return filename
