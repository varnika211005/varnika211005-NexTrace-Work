import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import { SeverityBadge } from "../components/Badge";
import { api } from "../api/client";

function StatCard({ label, value, accent = "text-gray-100" }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted font-semibold">{label}</div>
      <div className={`text-2xl font-bold mono mt-1.5 ${accent}`}>{value}</div>
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const color = value >= 70 ? "bg-good" : value >= 40 ? "bg-warn" : "bg-bad";
  return (
    <div className="mb-2.5">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-muted capitalize">{label.replace(/_/g, " ")}</span>
        <span className="mono text-gray-300">{value}%</span>
      </div>
      <div className="h-1.5 bg-[#1a2130] rounded overflow-hidden">
        <div className={`${color} h-full`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [showWhy, setShowWhy] = useState(false);

  useEffect(() => {
    api.dashboard().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="text-bad text-sm">{error}</div>;
  if (!data) return <div className="text-muted text-sm">Loading dashboard…</div>;

  if (data.total_entities === 0) {
    return (
      <div>
        <PageHeader title="Dashboard" subtitle="No investigation data loaded yet." />
        <EmptyState
          title="No data to analyze"
          subtitle="An Admin Investigator needs to upload evidence datasets and run processing before the dashboard can populate."
          action={
            <Link to="/admin/ingestion" className="inline-block px-4 py-2 rounded-md bg-accent text-bg font-semibold text-sm hover:bg-accent2">
              Go to Data Ingestion →
            </Link>
          }
        />
      </div>
    );
  }

  if (!data.analyzed) {
    return (
      <div>
        <PageHeader title="Dashboard" subtitle="Data uploaded but not yet processed." />
        <EmptyState
          title="Processing required"
          subtitle="Data has been ingested, but the relationship graph has not been built yet."
          action={
            <Link to="/admin/processing" className="inline-block px-4 py-2 rounded-md bg-accent text-bg font-semibold text-sm hover:bg-accent2">
              Go to Processing Pipeline →
            </Link>
          }
        />
      </div>
    );
  }

  const subject = data.default_subject;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={subject ? `Current focus: Case ${subject.case_id} — ${subject.name}` : "Investigation overview"}
      >
        <Link to="/network" className="px-3 py-1.5 rounded-md bg-accent text-bg text-sm font-semibold hover:bg-accent2">
          Open Network Graph →
        </Link>
        <Link to="/reports" className="px-3 py-1.5 rounded-md bg-[#1a2130] border border-border text-gray-200 text-sm font-semibold hover:bg-[#212a3d]">
          Generate Report
        </Link>
      </PageHeader>

      {/* Row 1: Subject Profile + Reliability (mandatory hero elements) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        {subject ? (
          <div className="bg-card border border-border rounded-lg p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-accent/10 text-accent border border-accent/30">
                Subject Profile
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-warn/10 text-warn border border-warn/30">
                Person of Interest
              </span>
            </div>
            <div className="text-lg font-semibold text-gray-100">{subject.name}</div>
            <div className="text-xs text-muted mono mb-3">
              {subject.id} · Case {subject.case_id} · {subject.crime_type}
            </div>
            <p className="text-sm text-gray-300 leading-relaxed">{subject.summary}</p>
            <Link to={`/entities/${subject.id}`} className="inline-block mt-4 text-accent text-sm font-medium hover:underline">
              View Full Profile →
            </Link>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg p-5 text-muted text-sm">No connected subject to feature yet.</div>
        )}

        {subject && (
          <div className="bg-card border border-border rounded-lg p-5">
            <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-2">Reliability</div>
            <div className="flex items-end gap-3 mb-1">
              <span className="text-4xl font-bold mono text-gray-100">{subject.reliability.overall}%</span>
              <span
                className={`mb-1.5 text-xs font-semibold uppercase tracking-wider ${
                  subject.reliability.overall >= 70 ? "text-good" : subject.reliability.overall >= 40 ? "text-warn" : "text-bad"
                }`}
              >
                {subject.reliability.overall >= 70 ? "High Confidence" : subject.reliability.overall >= 40 ? "Medium Confidence" : "Low Confidence"}
              </span>
            </div>
            <div className="mt-4">
              {Object.entries(subject.reliability.components).map(([k, v]) => (
                <ScoreBar key={k} label={k} value={v as number} />
              ))}
            </div>
            <button onClick={() => setShowWhy(!showWhy)} className="text-accent text-xs font-medium hover:underline mt-2">
              {showWhy ? "Hide" : "Why this score?"}
            </button>
            {showWhy && (
              <p className="text-[11px] text-muted mt-2 border-t border-border pt-2 leading-relaxed">
                Reliability reflects the strength and consistency of available evidence and entity
                matching (evidence strength, how many distinct evidence sources agree, whether prior
                matches were reviewed, temporal consistency, and the proportion of high-confidence
                links). It does not establish guilt.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Row 2: stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <StatCard label="Total Entities" value={data.total_entities} />
        <StatCard label="Relationships" value={data.total_relationships} accent="text-accent" />
        <StatCard label="Communities" value={data.community_count} />
        <StatCard label="Unresolved Identifiers" value={data.unresolved_identifiers} accent="text-warn" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Confidence breakdown */}
        <div className="bg-card border border-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-gray-100 mb-4">Relationship Confidence</h3>
          {[
            { label: "High", value: data.high_confidence_links, color: "bg-good" },
            { label: "Medium", value: data.medium_confidence_links, color: "bg-warn" },
            { label: "Low", value: data.low_confidence_links, color: "bg-bad" },
          ].map((row) => (
            <div key={row.label} className="mb-3">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted">{row.label} confidence</span>
                <span className="mono text-gray-300">{row.value}</span>
              </div>
              <div className="h-2 bg-[#1a2130] rounded overflow-hidden">
                <div className={`${row.color} h-full`} style={{ width: `${data.total_relationships ? (row.value / data.total_relationships) * 100 : 0}%` }} />
              </div>
            </div>
          ))}
        </div>

        {/* Evidence sources */}
        <div className="bg-card border border-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-gray-100 mb-4">Evidence Sources Ingested</h3>
          <div className="space-y-2 text-sm">
            {Object.entries(data.evidence_source_counts).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-muted uppercase text-xs tracking-wider">{k}</span>
                <span className="mono text-gray-200">{v as number}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Crime type breakdown */}
        <div className="bg-card border border-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-gray-100 mb-4">Crime Type Breakdown</h3>
          <div className="space-y-2">
            {Object.entries(data.crime_type_breakdown).map(([type, count]) => (
              <div key={type} className="flex items-center gap-2 text-xs">
                <span className="w-24 truncate text-muted">{type}</span>
                <div className="flex-1 h-2 bg-[#1a2130] rounded overflow-hidden">
                  <div className="h-full bg-accent2" style={{ width: `${((count as number) / Math.max(...(Object.values(data.crime_type_breakdown) as number[]), 1)) * 100}%` }} />
                </div>
                <span className="mono text-gray-300 w-4 text-right">{count as number}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Intelligence indicators (contextual - not a standalone alerts page) */}
      <div className="mt-5 bg-card border border-border rounded-lg p-5">
        <h3 className="text-sm font-semibold text-gray-100 mb-1">Intelligence Indicators</h3>
        <p className="text-xs text-muted mb-4">Pattern findings surfaced from cross-source analysis — investigative leads, not conclusions.</p>
        {data.intelligence_indicators.length === 0 ? (
          <div className="text-muted text-sm">No notable patterns detected yet.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.intelligence_indicators.map((ind: any, i: number) => (
              <div key={i} className="border border-border rounded-md p-3 bg-[#0f1420]">
                <div className="flex items-center gap-2 mb-1.5">
                  <SeverityBadge severity={ind.severity} />
                  <span className="text-gray-200 text-sm font-medium">{ind.title}</span>
                </div>
                <p className="text-xs text-muted leading-relaxed">{ind.explanation}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
