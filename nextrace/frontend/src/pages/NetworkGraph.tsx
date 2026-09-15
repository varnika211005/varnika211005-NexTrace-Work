import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import ForceGraph2D from "react-force-graph-2d";
import PageHeader from "../components/PageHeader";
import ConfidenceBadge from "../components/ConfidenceBadge";
import { api } from "../api/client";

const COMMUNITY_COLORS = ["#22d3ee", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#f472b6", "#60a5fa", "#facc15"];
const CATEGORY_OPTIONS = [
  { key: "call", label: "Call / SMS" },
  { key: "financial", label: "Financial Transfer" },
  { key: "cctv", label: "CCTV Co-location" },
  { key: "report", label: "Report Mention" },
  { key: "case", label: "Same Case" },
  { key: "address", label: "Shared Address" },
  { key: "vehicle", label: "Shared Vehicle" },
  { key: "organization", label: "Colleague" },
  { key: "notes", label: "Notes Mention" },
];

function nodeShape(subtype: string) {
  if (subtype === "Person") return "circle";
  if (subtype === "Unknown Phone") return "rect";
  if (subtype === "Unknown Account") return "diamond";
  return "triangle"; // Unidentified Vehicle
}

export default function NetworkGraph() {
  const [params] = useSearchParams();
  const focusId = params.get("focus");

  const [graph, setGraph] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [minConfidence, setMinConfidence] = useState(0);
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set(CATEGORY_OPTIONS.map((c) => c.key)));
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [selectedEdge, setSelectedEdge] = useState<any>(null);
  const [dims, setDims] = useState({ width: 800, height: 600 });
  const [rightTab, setRightTab] = useState<"details" | "analytics" | "path">("analytics");
  const [analytics, setAnalytics] = useState<any>(null);
  const [pathFrom, setPathFrom] = useState("");
  const [pathTo, setPathTo] = useState("");
  const [pathResult, setPathResult] = useState<any>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);

  useEffect(() => {
    api.getGraph(0).then(setGraph).catch((e) => setError(e.message));
    api.graphAnalytics().then(setAnalytics).catch(() => {});
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const observer = new ResizeObserver(() => setDims({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (focusId && graph) {
      const node = graph.nodes.find((n: any) => n.id === focusId);
      if (node) {
        setSelectedNode(node);
        setRightTab("details");
      }
    }
  }, [focusId, graph]);

  const graphData = useMemo(() => {
    if (!graph) return { nodes: [], links: [] };
    const edges = graph.edges.filter(
      (e: any) => e.confidence >= minConfidence && e.evidence.some((ev: any) => activeCategories.has(ev.category))
    );
    return { nodes: graph.nodes.map((n: any) => ({ ...n })), links: edges.map((e: any) => ({ ...e })) };
  }, [graph, minConfidence, activeCategories]);

  const neighborIds = useMemo(() => {
    if (!selectedNode || !graph) return null;
    const ids = new Set<string>([selectedNode.id]);
    graphData.links.forEach((e: any) => {
      const s = typeof e.source === "object" ? e.source.id : e.source;
      const t = typeof e.target === "object" ? e.target.id : e.target;
      if (s === selectedNode.id) ids.add(t);
      if (t === selectedNode.id) ids.add(s);
    });
    return ids;
  }, [selectedNode, graph, graphData]);

  function toggleCategory(key: string) {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  async function runPathAnalysis() {
    if (!pathFrom || !pathTo) return;
    try {
      const result = await api.shortestPath(pathFrom, pathTo);
      setPathResult(result);
    } catch (e: any) {
      setPathResult({ error: e.message });
    }
  }

  if (error) return <div className="text-bad text-sm">{error}</div>;
  if (!graph) return <div className="text-muted text-sm">Loading graph…</div>;

  if (graph.nodes.length === 0) {
    return (
      <div>
        <PageHeader title="Network Analysis" subtitle="No entities loaded." />
        <div className="bg-card border border-border rounded-lg p-10 text-center text-muted text-sm">
          No data yet. <Link to="/admin/ingestion" className="text-accent underline">Go to Data Ingestion</Link>
        </div>
      </div>
    );
  }

  const sortedPersons = [...graph.nodes].filter((n: any) => n.subtype === "Person").sort((a: any, b: any) => a.name.localeCompare(b.name));

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col">
      <PageHeader title="Network Analysis" subtitle="Relationships across every ingested evidence source — calls, financial transfers, CCTV, and reports." />

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[230px_1fr_320px] gap-5 min-h-0">
        {/* Left: filters */}
        <div className="bg-card border border-border rounded-lg p-4 h-fit overflow-y-auto max-h-full">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Confidence Filter</h3>
          <label className="text-xs text-muted">Minimum: <span className="text-gray-200 mono">{minConfidence}%</span></label>
          <input type="range" min={0} max={100} step={5} value={minConfidence} onChange={(e) => setMinConfidence(Number(e.target.value))} className="w-full mt-2 accent-accent" />

          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2 mt-5">Relationship Types</h3>
          <div className="space-y-1.5">
            {CATEGORY_OPTIONS.map((c) => (
              <label key={c.key} className="flex items-center gap-2 text-xs text-gray-300">
                <input type="checkbox" checked={activeCategories.has(c.key)} onChange={() => toggleCategory(c.key)} />
                {c.label}
              </label>
            ))}
          </div>

          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2 mt-5">Legend</h3>
          <div className="space-y-1.5 text-[11px] text-muted">
            <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-good inline-block" /> High confidence edge</div>
            <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-warn inline-block" /> Medium confidence</div>
            <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-bad inline-block" /> Low confidence</div>
            <div className="pt-1">● Person &nbsp; ■ Unknown Phone &nbsp; ◆ Unknown Account &nbsp; ▲ Unidentified Vehicle</div>
            <div>Node color = detected community cluster</div>
          </div>

          <button onClick={() => { setSelectedNode(null); setSelectedEdge(null); fgRef.current?.zoomToFit(400); }} className="mt-5 w-full text-xs px-3 py-1.5 rounded-md border border-border text-gray-300 hover:bg-[#131926]">
            Fit Graph / Reset
          </button>
        </div>

        {/* Center: graph */}
        <div ref={containerRef} className="bg-[#0a0e14] border border-border rounded-lg overflow-hidden relative min-h-[500px]">
          <ForceGraph2D
            ref={fgRef}
            graphData={graphData as any}
            width={dims.width}
            height={dims.height}
            backgroundColor="#0a0e14"
            nodeId="id"
            nodeLabel={(n: any) => `${n.name} (${n.subtype})`}
            nodeRelSize={5}
            nodeVal={(n: any) => 2 + n.degree}
            nodeColor={(n: any) => {
              if (neighborIds && !neighborIds.has(n.id)) return "#1f2937";
              if (n.isolated) return "#4b5563";
              if (n.subtype !== "Person") return "#f87171";
              return COMMUNITY_COLORS[n.community % COMMUNITY_COLORS.length];
            }}
            nodeCanvasObjectMode={() => "after"}
            nodeCanvasObject={(n: any, ctx, globalScale) => {
              const label = n.subtype === "Person" ? n.name.split(" ")[0] : n.subtype;
              const fontSize = 10 / globalScale;
              ctx.font = `${fontSize}px Inter, sans-serif`;
              ctx.textAlign = "center";
              ctx.fillStyle = neighborIds && !neighborIds.has(n.id) ? "#4b5563" : "#e6e9ef";
              ctx.fillText(label, n.x, n.y + 10 / globalScale);
            }}
            linkColor={(l: any) => (l.confidence_band === "High" ? "#34d39990" : l.confidence_band === "Medium" ? "#fbbf2470" : "#f8717150")}
            linkWidth={(l: any) => 0.6 + l.confidence / 40}
            linkDirectionalParticles={0}
            onNodeClick={(n: any) => { setSelectedEdge(null); setSelectedNode(n); setRightTab("details"); }}
            onLinkClick={(l: any) => { setSelectedNode(null); setSelectedEdge(l); setRightTab("details"); }}
            onBackgroundClick={() => { setSelectedNode(null); setSelectedEdge(null); }}
            cooldownTicks={100}
          />
        </div>

        {/* Right: tabs (Details / Analytics / Path Analysis) */}
        <div className="bg-card border border-border rounded-lg flex flex-col h-fit max-h-full overflow-hidden">
          <div className="flex border-b border-border text-xs">
            {(["details", "analytics", "path"] as const).map((t) => (
              <button key={t} onClick={() => setRightTab(t)} className={`flex-1 py-2.5 font-medium capitalize transition-colors ${rightTab === t ? "text-accent border-b-2 border-accent" : "text-muted hover:text-gray-200"}`}>
                {t === "path" ? "Path Analysis" : t}
              </button>
            ))}
          </div>

          <div className="p-4 overflow-y-auto">
            {rightTab === "details" && !selectedNode && !selectedEdge && (
              <div className="text-muted text-sm">Click a node or edge to inspect it.</div>
            )}
            {rightTab === "details" && selectedNode && (
              <div>
                <h3 className="text-gray-100 font-semibold mb-1">{selectedNode.name}</h3>
                <div className="text-xs text-muted mono mb-3">{selectedNode.id} · {selectedNode.subtype}</div>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-muted">Crime Type</span><span className="text-gray-200">{selectedNode.crime_type || "—"}</span></div>
                  <div className="flex justify-between"><span className="text-muted">Case</span><span className="text-gray-200 mono">{selectedNode.case_id || "—"}</span></div>
                  <div className="flex justify-between"><span className="text-muted">Connections</span><span className="text-gray-200 mono">{selectedNode.degree}</span></div>
                  <div className="flex justify-between"><span className="text-muted">Community</span><span className="text-gray-200 mono">{selectedNode.isolated ? "None" : `#${selectedNode.community}`}</span></div>
                </div>
                <Link to={`/entities/${selectedNode.id}`} className="mt-4 block text-center px-3 py-2 rounded-md bg-accent text-bg text-sm font-semibold hover:bg-accent2">
                  Open Full Profile →
                </Link>
              </div>
            )}
            {rightTab === "details" && selectedEdge && (
              <div>
                <h3 className="text-gray-100 font-semibold mb-1 text-sm">Relationship</h3>
                <div className="text-sm text-gray-300 mb-2">
                  {(selectedEdge.source as any).name || selectedEdge.source} <span className="text-accent">↔</span> {(selectedEdge.target as any).name || selectedEdge.target}
                </div>
                <div className="mb-3"><ConfidenceBadge score={selectedEdge.confidence} band={selectedEdge.confidence_band} size="md" /></div>
                <div className="text-xs text-muted mb-1">Primary Type</div>
                <div className="text-sm text-gray-200 mb-3">{selectedEdge.primary_type}</div>
                <div className="text-xs text-muted uppercase tracking-wider mb-1.5">Supporting Evidence</div>
                <div className="space-y-2">
                  {selectedEdge.evidence.map((e: any, i: number) => (
                    <div key={i} className="text-sm border border-border rounded p-2 bg-[#0f1420]">
                      <div className="flex justify-between text-xs"><span className="text-accent">{e.label}</span><span className="text-muted mono">+{e.score}</span></div>
                      {e.examples.map((ex: string, j: number) => <div key={j} className="text-gray-400 text-xs">• {ex}</div>)}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {rightTab === "analytics" && analytics && (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-[#0f1420] border border-border rounded p-2 text-center"><div className="text-lg font-bold mono text-gray-100">{analytics.nodes}</div><div className="text-[10px] text-muted uppercase">Nodes</div></div>
                  <div className="bg-[#0f1420] border border-border rounded p-2 text-center"><div className="text-lg font-bold mono text-gray-100">{analytics.relationships}</div><div className="text-[10px] text-muted uppercase">Relationships</div></div>
                  <div className="bg-[#0f1420] border border-border rounded p-2 text-center"><div className="text-lg font-bold mono text-gray-100">{analytics.communities}</div><div className="text-[10px] text-muted uppercase">Communities</div></div>
                  <div className="bg-[#0f1420] border border-border rounded p-2 text-center"><div className="text-lg font-bold mono text-gray-100">{analytics.density}</div><div className="text-[10px] text-muted uppercase">Density</div></div>
                </div>
                <div>
                  <div className="text-xs text-muted uppercase tracking-wider mb-2">Central Entities (by connections)</div>
                  {analytics.central_entities.map((c: any) => (
                    <Link key={c.id} to={`/entities/${c.id}`} className="flex justify-between py-1 text-gray-300 hover:text-accent">
                      <span>{c.name}</span><span className="mono text-muted">{c.degree}</span>
                    </Link>
                  ))}
                </div>
                <div>
                  <div className="text-xs text-muted uppercase tracking-wider mb-2 mt-3">Bridge Entities</div>
                  {analytics.bridge_entities.map((b: any) => (
                    <Link key={b.id} to={`/entities/${b.id}`} className="block py-1 text-gray-300 hover:text-accent">{b.name}</Link>
                  ))}
                </div>
              </div>
            )}

            {rightTab === "path" && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-muted">From</label>
                  <select value={pathFrom} onChange={(e) => setPathFrom(e.target.value)} className="w-full mt-1 bg-[#0f1420] border border-border rounded px-2 py-1.5 text-sm text-gray-200">
                    <option value="">Select entity…</option>
                    {sortedPersons.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted">To</label>
                  <select value={pathTo} onChange={(e) => setPathTo(e.target.value)} className="w-full mt-1 bg-[#0f1420] border border-border rounded px-2 py-1.5 text-sm text-gray-200">
                    <option value="">Select entity…</option>
                    {sortedPersons.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <button onClick={runPathAnalysis} className="w-full py-2 rounded-md bg-accent text-bg text-sm font-semibold hover:bg-accent2">Find Shortest Path</button>
                {pathResult && (
                  <div className="mt-3 text-sm">
                    {pathResult.error && <div className="text-bad text-xs">{pathResult.error}</div>}
                    {pathResult.path === null && <div className="text-muted text-xs">No path found between these entities.</div>}
                    {pathResult.hops && (
                      <div className="space-y-2">
                        <div className="text-xs text-muted">{pathResult.hop_count} hop(s)</div>
                        {pathResult.hops.map((h: any, i: number) => (
                          <div key={i} className="border border-border rounded p-2 bg-[#0f1420] text-xs">
                            <div className="text-gray-200">{h.from_name} → {h.to_name}</div>
                            <div className="text-muted">{h.primary_type} · {h.confidence.toFixed(0)}%</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
