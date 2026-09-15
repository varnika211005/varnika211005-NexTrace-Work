import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import { api } from "../api/client";

const TYPE_COLORS: Record<string, string> = {
  "CDR Event": "border-accent/40 text-accent",
  "Financial Event": "border-good/40 text-good",
  "CCTV Observation": "border-warn/40 text-warn",
  "Report Filed": "border-purple/40 text-purple",
};

export default function Timeline() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [caseId, setCaseId] = useState("");
  const [eventType, setEventType] = useState("");

  function load() {
    setLoading(true);
    const params: Record<string, string> = {};
    if (caseId) params.case_id = caseId;
    if (eventType) params.event_type = eventType;
    api.timeline(params).then(setEvents).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []); // eslint-disable-line

  return (
    <div>
      <PageHeader title="Timeline Analysis" subtitle="Chronological view of every call, transaction, sighting, and report across the dataset." />

      <div className="flex gap-3 mb-5 flex-wrap">
        <input value={caseId} onChange={(e) => setCaseId(e.target.value)} placeholder="Filter by case ID (e.g. NX-0241)"
          className="bg-card border border-border rounded-md px-3 py-2 text-sm text-gray-100 placeholder-muted focus:outline-none focus:border-accent w-64" />
        <select value={eventType} onChange={(e) => setEventType(e.target.value)} className="bg-card border border-border rounded-md px-3 py-2 text-sm text-gray-200">
          <option value="">All event types</option>
          <option value="CDR Event">Call / SMS</option>
          <option value="Financial Event">Financial</option>
          <option value="CCTV Observation">CCTV</option>
          <option value="Report Filed">Report Filed</option>
        </select>
        <button onClick={load} className="px-4 py-2 rounded-md bg-accent text-bg text-sm font-semibold hover:bg-accent2">Apply</button>
      </div>

      {loading ? (
        <div className="text-muted text-sm">Loading…</div>
      ) : events.length === 0 ? (
        <EmptyState title="No events found" subtitle="Try clearing filters, or ingest and process a dataset first." />
      ) : (
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="relative pl-5 border-l border-border space-y-5">
            {events.map((ev, i) => (
              <div key={i} className="relative">
                <span className="absolute -left-[25px] top-1 w-2.5 h-2.5 rounded-full bg-accent" />
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted mono">{ev.timestamp || "undated"}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${TYPE_COLORS[ev.type] || "border-border text-muted"}`}>
                    {ev.type}
                  </span>
                </div>
                <div className="text-sm text-gray-200 mt-1">{ev.description}</div>
                <div className="text-[10px] text-muted mono">{ev.id} · {ev.source}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
