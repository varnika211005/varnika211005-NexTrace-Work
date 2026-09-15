import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import { api } from "../api/client";

export default function Cases() {
  const [cases, setCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listCases().then(setCases).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-muted text-sm">Loading…</div>;

  return (
    <div>
      <PageHeader title="Cases" subtitle="Every case derived from ingested subject records and investigation reports." />
      {cases.length === 0 ? (
        <EmptyState title="No cases found" subtitle="Ingest and process data to populate cases." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cases.map((c) => (
            <Link key={c.case_id} to={`/cases/${c.case_id}`} className="bg-card border border-border rounded-lg p-5 hover:border-accent/50 transition-colors">
              <div className="flex justify-between items-start mb-2">
                <span className="mono text-accent text-sm font-semibold">{c.case_id}</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-warn/10 text-warn border border-warn/30">{c.status}</span>
              </div>
              <div className="text-gray-100 font-medium mb-1">{c.title}</div>
              <div className="text-xs text-muted mb-3">{c.opened_date ? `Opened ${c.opened_date}` : "Open date unknown"} · {c.crime_types.join(", ")}</div>
              <div className="flex gap-4 text-xs text-muted">
                <span><span className="text-gray-200 font-semibold mono">{c.subject_count}</span> subjects</span>
                <span><span className="text-gray-200 font-semibold mono">{c.relationship_count}</span> relationships</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
