import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import ConfidenceBadge from "../components/ConfidenceBadge";
import { api } from "../api/client";

function DetailRow({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="flex justify-between py-2 border-b border-border/60 last:border-0 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-gray-200 mono text-right">{value || "—"}</span>
    </div>
  );
}

const TABS = ["Overview", "Relationships", "Timeline", "Evidence"] as const;

export default function EntityProfile() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    if (!id) return;
    setData(null);
    setTab("Overview");
    api.getEntity(id).then(setData).catch((e) => setError(e.message));
  }, [id]);

  if (error) return <div className="text-bad text-sm">{error}</div>;
  if (!data) return <div className="text-muted text-sm">Loading profile…</div>;

  const { entity, summary, reliability, relationships, is_bridge_entity, degree_centrality_rank, evidence, timeline } = data;

  return (
    <div>
      <PageHeader title={entity.name} subtitle={`Entity ID: ${entity.id} · ${entity.node_subtype}`}>
        <Link to={`/network?focus=${entity.id}`} className="px-3 py-1.5 rounded-md bg-accent text-bg text-sm font-semibold hover:bg-accent2">
          View in Network →
        </Link>
        <Link to={`/reports?person_id=${entity.id}`} className="px-3 py-1.5 rounded-md bg-[#1a2130] border border-border text-gray-200 text-sm font-semibold hover:bg-[#212a3d]">
          Generate Report
        </Link>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        {/* Left: identity card, always visible */}
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-accent/10 text-accent border border-accent/30">
              {entity.is_unresolved ? "Unresolved Identifier" : "Person of Interest"}
            </span>
            {is_bridge_entity && (
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-warn/10 text-warn border border-warn/30">
                Bridge Entity
              </span>
            )}
          </div>
          <DetailRow label="Age" value={entity.age} />
          <DetailRow label="Gender" value={entity.gender} />
          <DetailRow label="Aliases" value={entity.aliases?.replace(/\|/g, ", ")} />
          <DetailRow label="Phone" value={entity.phone} />
          <DetailRow label="Alt. Phone" value={entity.alt_phone} />
          <DetailRow label="Address" value={entity.address} />
          <DetailRow label="Vehicle" value={entity.vehicle_number} />
          <DetailRow label="Account" value={entity.account_number} />
          <DetailRow label="Organization" value={entity.organization} />
          <DetailRow label="Case ID" value={entity.case_id} />
          <DetailRow label="Crime Type" value={entity.crime_type} />
          <DetailRow label="Status" value={entity.status} />
          <DetailRow label="First / Last Observed" value={entity.first_seen ? `${entity.first_seen} → ${entity.last_seen}` : null} />
          {entity.notes && (
            <div className="mt-3 pt-3 border-t border-border">
              <div className="text-muted text-xs mb-1">Case Notes</div>
              <div className="text-gray-300 text-sm italic">"{entity.notes}"</div>
            </div>
          )}
        </div>

        {/* Right: reliability + summary */}
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-card border border-border rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-100">Investigative Summary</h3>
              <div className="flex items-center gap-3 text-xs text-muted">
                {degree_centrality_rank && <span>Connectivity rank <span className="mono text-gray-300">#{degree_centrality_rank}</span></span>}
                <span className={`font-semibold ${reliability.overall >= 70 ? "text-good" : reliability.overall >= 40 ? "text-warn" : "text-bad"}`}>
                  Reliability {reliability.overall}%
                </span>
              </div>
            </div>
            <p className="text-sm text-gray-300 leading-relaxed">{summary}</p>
          </div>

          {/* Tabs */}
          <div className="bg-card border border-border rounded-lg">
            <div className="flex border-b border-border overflow-x-auto">
              {TABS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    tab === t ? "border-accent text-accent" : "border-transparent text-muted hover:text-gray-200"
                  }`}
                >
                  {t} {t === "Relationships" && `(${relationships.length})`}
                  {t === "Timeline" && `(${timeline.length})`}
                  {t === "Evidence" && `(${evidence.length})`}
                </button>
              ))}
            </div>

            <div className="p-5">
              {tab === "Overview" && (
                <div className="text-sm text-gray-300 space-y-3">
                  <p>
                    This profile aggregates every evidence source (call records, financial transactions,
                    CCTV sightings, investigation reports, and case-file fields) that name or resolve to{" "}
                    <span className="text-gray-100 font-medium">{entity.name}</span>.
                  </p>
                  <p className="text-muted text-xs">
                    Use the tabs above to inspect detected relationships (with full evidence provenance),
                    the chronological timeline of activity, and the raw evidence records themselves.
                  </p>
                </div>
              )}

              {tab === "Relationships" &&
                (relationships.length === 0 ? (
                  <div className="text-muted text-sm py-6 text-center">No connections detected for this entity.</div>
                ) : (
                  <div className="space-y-2">
                    {relationships.map((r: any) => (
                      <div key={r.id} className="border border-border rounded-md overflow-hidden">
                        <button
                          onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                          className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#131926] transition-colors text-left"
                        >
                          <div>
                            <Link to={`/entities/${r.target_id}`} onClick={(e) => e.stopPropagation()} className="text-gray-100 font-medium hover:text-accent">
                              {r.target_name}
                            </Link>
                            <span className="text-muted text-xs ml-2">{r.primary_type}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <ConfidenceBadge score={r.confidence} band={r.confidence_band} />
                            <span className="text-muted text-xs">{expanded === r.id ? "▲" : "▼"}</span>
                          </div>
                        </button>
                        {expanded === r.id && (
                          <div className="px-4 pb-3 bg-[#0f1420] space-y-2">
                            <div className="text-xs text-muted mb-1 mt-2 uppercase tracking-wider">Supporting Evidence</div>
                            {r.evidence.map((e: any, i: number) => (
                              <div key={i} className="text-sm border border-border rounded p-2.5 bg-card">
                                <div className="flex justify-between text-xs mb-1">
                                  <span className="text-accent font-medium">{e.label}</span>
                                  <span className="text-muted mono">{e.count} record(s) · +{e.score}</span>
                                </div>
                                {e.examples.map((ex: string, j: number) => (
                                  <div key={j} className="text-gray-400 text-xs">• {ex}</div>
                                ))}
                                <div className="text-muted text-[10px] mt-1 mono">source: {e.source_file}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}

              {tab === "Timeline" &&
                (timeline.length === 0 ? (
                  <div className="text-muted text-sm py-6 text-center">No timeline events for this entity.</div>
                ) : (
                  <div className="relative pl-5 border-l border-border space-y-4">
                    {timeline.map((ev: any, i: number) => (
                      <div key={i} className="relative">
                        <span className="absolute -left-[25px] top-1 w-2.5 h-2.5 rounded-full bg-accent" />
                        <div className="text-xs text-muted mono">{ev.timestamp || "undated"}</div>
                        <div className="text-sm text-gray-200 font-medium">{ev.type}</div>
                        <div className="text-sm text-gray-400">{ev.description}</div>
                        <div className="text-[10px] text-muted mono">{ev.source}</div>
                      </div>
                    ))}
                  </div>
                ))}

              {tab === "Evidence" &&
                (evidence.length === 0 ? (
                  <div className="text-muted text-sm py-6 text-center">No raw evidence records reference this entity.</div>
                ) : (
                  <div className="space-y-2">
                    {evidence.map((e: any, i: number) => (
                      <div key={i} className="border border-border rounded-md p-3 flex justify-between items-start gap-3">
                        <div>
                          <div className="text-xs text-accent font-medium uppercase tracking-wider">{e.type}</div>
                          <div className="text-sm text-gray-300">{e.detail}</div>
                          <div className="text-[10px] text-muted mono mt-1">{e.id} · {e.timestamp || "undated"}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
