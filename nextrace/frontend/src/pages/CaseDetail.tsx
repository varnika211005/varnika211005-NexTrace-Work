import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import { SeverityBadge } from "../components/Badge";
import { api } from "../api/client";

export default function CaseDetail() {
  const { caseId } = useParams<{ caseId: string }>();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!caseId) return;
    api.getCase(caseId).then(setData).catch((e) => setError(e.message));
  }, [caseId]);

  if (error) return <div className="text-bad text-sm">{error}</div>;
  if (!data) return <div className="text-muted text-sm">Loading…</div>;

  return (
    <div>
      <PageHeader title={data.title} subtitle={`Case ${data.case_id} · ${data.status}`}>
        <Link to={`/network`} className="px-3 py-1.5 rounded-md bg-accent text-bg text-sm font-semibold hover:bg-accent2">Open Network →</Link>
        <Link to={`/reports?case_id=${data.case_id}`} className="px-3 py-1.5 rounded-md bg-[#1a2130] border border-border text-gray-200 text-sm font-semibold hover:bg-[#212a3d]">Generate Report</Link>
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <div className="bg-card border border-border rounded-lg p-4"><div className="text-[11px] uppercase text-muted">Subjects</div><div className="text-2xl font-bold mono text-gray-100">{data.subjects.length}</div></div>
        <div className="bg-card border border-border rounded-lg p-4"><div className="text-[11px] uppercase text-muted">Relationships</div><div className="text-2xl font-bold mono text-accent">{data.relationship_count}</div></div>
        <div className="bg-card border border-border rounded-lg p-4"><div className="text-[11px] uppercase text-muted">Evidence Items</div><div className="text-2xl font-bold mono text-gray-100">{data.evidence_count}</div></div>
        <div className="bg-card border border-border rounded-lg p-4"><div className="text-[11px] uppercase text-muted">Reports Filed</div><div className="text-2xl font-bold mono text-gray-100">{data.reports.length}</div></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-card border border-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-gray-100 mb-3">Subjects</h3>
          <div className="space-y-2">
            {data.subjects.map((s: any) => (
              <Link key={s.id} to={`/entities/${s.id}`} className="flex justify-between items-center border border-border rounded p-2.5 hover:border-accent/50">
                <span className="text-gray-200 text-sm">{s.name}</span>
                <span className="text-muted text-xs">{s.crime_type}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-gray-100 mb-3">Intelligence Indicators</h3>
          {data.intelligence_indicators.length === 0 ? (
            <div className="text-muted text-sm">No pattern findings for this case yet.</div>
          ) : (
            <div className="space-y-2">
              {data.intelligence_indicators.map((ind: any, i: number) => (
                <div key={i} className="border border-border rounded p-2.5 bg-[#0f1420]">
                  <div className="flex items-center gap-2 mb-1"><SeverityBadge severity={ind.severity} /><span className="text-gray-200 text-sm font-medium">{ind.title}</span></div>
                  <p className="text-xs text-muted">{ind.explanation}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-lg p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold text-gray-100 mb-3">Investigation Reports</h3>
          {data.reports.length === 0 ? (
            <div className="text-muted text-sm">No reports filed for this case.</div>
          ) : (
            <div className="space-y-3">
              {data.reports.map((r: any) => (
                <div key={r.id} className="border border-border rounded p-3">
                  <div className="flex justify-between text-xs text-muted mb-1"><span className="mono">{r.id}</span><span>{r.date_filed}</span></div>
                  <div className="text-gray-100 font-medium text-sm">{r.title}</div>
                  <div className="text-gray-400 text-xs mt-1">{r.narrative_text}</div>
                  <div className="text-[10px] text-muted mt-1">Filed by {r.officer}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-lg p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold text-gray-100 mb-3">Assigned Investigators</h3>
          {data.assigned_investigators.length === 0 ? (
            <div className="text-muted text-sm">No investigators formally assigned to this case yet (see Admin → Access Control).</div>
          ) : (
            <div className="flex gap-2 flex-wrap">
              {data.assigned_investigators.map((a: any, i: number) => (
                <span key={i} className="px-2.5 py-1 rounded-md border border-border text-xs text-gray-300">{a.analyst_id} · {a.access_level}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
