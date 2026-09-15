import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import { Link } from "react-router-dom";
import { api } from "../api/client";

const TYPES = ["CDR", "Financial", "CCTV", "Report"];

export default function Evidence() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  function load() {
    setLoading(true);
    const params: Record<string, string> = {};
    if (type) params.evidence_type = type;
    if (q) params.q = q;
    api.evidenceList(params).then(setItems).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []); // eslint-disable-line

  async function openDetail(item: any) {
    setDetailLoading(true);
    try {
      const d = await api.evidenceDetail(item.evidence_type, item.id);
      setDetail({ ...d, evidence_type: item.evidence_type });
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <div className="relative">
      <PageHeader title="Evidence Repository" subtitle="Every raw record ingested — call logs, financial transactions, CCTV sightings, and reports." />

      <div className="flex gap-3 mb-5 flex-wrap">
        <div className="flex gap-1.5">
          <button onClick={() => setType("")} className={`px-3 py-1.5 rounded-md text-xs font-medium border ${type === "" ? "bg-accent text-bg border-accent" : "border-border text-muted hover:text-gray-200"}`}>All</button>
          {TYPES.map((t) => (
            <button key={t} onClick={() => setType(t)} className={`px-3 py-1.5 rounded-md text-xs font-medium border ${type === t ? "bg-accent text-bg border-accent" : "border-border text-muted hover:text-gray-200"}`}>{t}</button>
          ))}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} placeholder="Search evidence…"
          className="flex-1 min-w-[200px] bg-card border border-border rounded-md px-3 py-2 text-sm text-gray-100 placeholder-muted focus:outline-none focus:border-accent" />
        <button onClick={load} className="px-4 py-2 rounded-md bg-accent text-bg text-sm font-semibold hover:bg-accent2">Search</button>
      </div>

      {loading ? (
        <div className="text-muted text-sm">Loading…</div>
      ) : items.length === 0 ? (
        <EmptyState title="No evidence found" subtitle="Try clearing filters, or ingest a dataset first." />
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#0f1420] text-muted text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Evidence ID</th>
                <th className="text-left px-4 py-3 font-semibold">Type</th>
                <th className="text-left px-4 py-3 font-semibold">Timestamp</th>
                <th className="text-left px-4 py-3 font-semibold">Summary</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.evidence_type}-${item.id}`} className="border-t border-border hover:bg-[#131926] cursor-pointer" onClick={() => openDetail(item)}>
                  <td className="px-4 py-3 mono text-gray-300">{item.id}</td>
                  <td className="px-4 py-3 text-accent text-xs font-medium">{item.evidence_type}</td>
                  <td className="px-4 py-3 mono text-gray-400 text-xs">{item.timestamp || "—"}</td>
                  <td className="px-4 py-3 text-gray-300">{item.summary}</td>
                  <td className="px-4 py-3 text-right text-accent text-xs">View →</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail drawer */}
      {(detail || detailLoading) && (
        <div className="fixed inset-0 bg-black/50 z-20 flex justify-end" onClick={() => setDetail(null)}>
          <div className="w-full max-w-md bg-card border-l border-border h-full p-6 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {detailLoading && <div className="text-muted text-sm">Loading…</div>}
            {detail && !detailLoading && (
              <div>
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <div className="text-xs text-accent uppercase tracking-wider font-semibold">{detail.evidence_type}</div>
                    <h3 className="text-gray-100 font-semibold text-lg">{detail.record.id}</h3>
                  </div>
                  <button onClick={() => setDetail(null)} className="text-muted hover:text-gray-200">✕</button>
                </div>

                <div className="space-y-1.5 mb-5">
                  {Object.entries(detail.record).map(([k, v]) => (
                    <div key={k} className="flex justify-between text-sm border-b border-border/60 py-1.5">
                      <span className="text-muted">{k.replace(/_/g, " ")}</span>
                      <span className="text-gray-200 text-right ml-3 mono">{String(v ?? "—")}</span>
                    </div>
                  ))}
                </div>

                <h4 className="text-sm font-semibold text-gray-100 mb-2">Contributes To</h4>
                {detail.contributes_to_relationships.length === 0 ? (
                  <div className="text-muted text-xs">This record has not yet contributed to any detected relationship.</div>
                ) : (
                  <div className="space-y-2">
                    {detail.contributes_to_relationships.map((r: any) => (
                      <div key={r.relationship_id} className="text-sm border border-border rounded p-2 bg-[#0f1420]">
                        {r.source_name} ↔ {r.target_name} <span className="text-muted text-xs">({r.confidence.toFixed(0)}%)</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
