import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import ForceGraph2D from "react-force-graph-2d";
import { forceCollide } from "d3-force";
import PageHeader from "../components/PageHeader";
import ConfidenceBadge from "../components/ConfidenceBadge";
import { api } from "../api/client";

const COMMUNITY_COLORS = ["#3b82f6", "#22d3ee", "#34d399", "#fbbf24", "#f472b6", "#a78bfa", "#60a5fa", "#facc15"];

const SUBTYPE_STYLE: Record<string, { fill: string; text: string }> = {
  "Unknown Phone": { fill: "#10b981", text: "#062018" },
  "Unknown Account": { fill: "#ef4444", text: "#2a0808" },
  "Unidentified Vehicle": { fill: "#a855f7", text: "#1c0a2e" },
};

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

const CATEGORY_TO_EVIDENCE: Record<string, string> = {
  call: "CDR",
  financial: "Financial",
  cctv: "CCTV",
  report: "Report",
};

function shortEdgeLabel(primaryType: string): string {
  const t = primaryType.toLowerCase();
  if (t.includes("call")) return "CALLED";
  if (t.includes("financial")) return "TRANSFERRED";
  if (t.includes("cctv") || t.includes("co-located")) return "SEEN TOGETHER";
  if (t.includes("report")) return "MENTIONED";
  if (t.includes("case")) return "CO-ACCUSED";
  if (t.includes("address") || t.includes("residence")) return "SAME ADDRESS";
  if (t.includes("vehicle")) return "SHARED VEHICLE";
  if (t.includes("colleague")) return "COLLEAGUE";
  return "ASSOCIATED";
}

function extractLabel(name: string): string {
  const match = name.match(/\(([^)]+)\)/);
  return match ? match[1] : name;
}

function nodeRadius(n: any): number {
  // Mirrors force-graph's own sizing (nodeRelSize * sqrt(val)) so collision matches what's drawn.
  const val = n.subtype === "Person" ? 2 + (n.degree || 0) : 3;
  return 5 * Math.sqrt(val) + (n.subtype === "Person" ? 4 : 10);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const outerRef = useRef<HTMLDivElement>(null);
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
    function onFsChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  useEffect(() => {
    if (focusId && graph) {
      const node = graph.nodes.find((n: any) => n.id === focusId);
      if (node) focusOnNode(node);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, graph]);

  const graphData = useMemo(() => {
    if (!graph) return { nodes: [], links: [] };
    const edges = graph.edges.filter(
      (e: any) => e.confidence >= minConfidence && e.evidence.some((ev: any) => activeCategories.has(ev.category))
    );
    return { nodes: graph.nodes.map((n: any) => ({ ...n })), links: edges.map((e: any) => ({ ...e })) };
  }, [graph, minConfidence, activeCategories]);

  // Spread the layout out: stronger repulsion, longer link distance, and a collision force
  // so nodes never overlap in the first place. Re-applied whenever the visible graph changes
  // (filters, confidence slider) since react-force-graph resets its internal engine each time.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || graphData.nodes.length === 0) return;
    const charge = fg.d3Force("charge");
    if (charge) charge.strength(-220).distanceMax(600);
    const link = fg.d3Force("link");
    if (link) link.distance((l: any) => 70 + (nodeRadius(l.source) + nodeRadius(l.target)) * 0.6).strength(0.25);
    fg.d3Force("collide", forceCollide((n: any) => nodeRadius(n) + 12));
    fg.d3ReheatSimulation();
  }, [graphData]);

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

  const searchResults = useMemo(() => {
    if (!graph || !searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return graph.nodes.filter((n: any) => n.name.toLowerCase().includes(q)).slice(0, 8);
  }, [graph, searchQuery]);

  function toggleCategory(key: string) {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function focusOnNode(node: any) {
    setSelectedEdge(null);
    setSelectedNode(node);
    setRightTab("details");
    setSearchOpen(false);
    setSearchQuery(node.name);
    // Give the simulation a moment to have real x/y if the graph just mounted
    const doFocus = () => {
      const liveNode = fgRef.current?.graphData?.().nodes?.find((n: any) => n.id === node.id) || node;
      if (liveNode && liveNode.x !== undefined) {
        fgRef.current?.centerAt(liveNode.x, liveNode.y, 700);
        fgRef.current?.zoom(5, 700);
      }
    };
    if (node.x !== undefined) doFocus();
    else setTimeout(doFocus, 400);
  }

  function unpinAll() {
    graphData.nodes.forEach((n: any) => {
      n.fx = undefined;
      n.fy = undefined;
    });
    fgRef.current?.d3ReheatSimulation();
  }

  function zoomIn() {
    const current = fgRef.current?.zoom() || 1;
    fgRef.current?.zoom(current * 1.5, 300);
  }
  function zoomOut() {
    const current = fgRef.current?.zoom() || 1;
    fgRef.current?.zoom(current / 1.5, 300);
  }

  async function toggleFullscreen() {
    if (!document.fullscreenElement) {
      await outerRef.current?.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
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
    <div ref={outerRef} className={isFullscreen ? "bg-bg h-screen flex flex-col p-4" : ""}>
      <div className={isFullscreen ? "flex-1 flex flex-col min-h-0" : "h-[calc(100vh-64px)] flex flex-col"}>
        <PageHeader title="Network Analysis" subtitle="Relationships across every ingested evidence source — calls, financial transfers, CCTV, and reports.">
          <button onClick={toggleFullscreen} className="px-3 py-1.5 rounded-md bg-[#1a2130] border border-border text-gray-200 text-sm font-semibold hover:bg-[#212a3d]">
            {isFullscreen ? "Exit Full Screen ⤢" : "Full Screen ⛶"}
          </button>
        </PageHeader>

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
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-accent inline-block" /> Person</div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded inline-block" style={{ background: "#10b981" }} /> Unknown Phone</div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded inline-block" style={{ background: "#ef4444" }} /> Unknown Account</div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded inline-block" style={{ background: "#a855f7" }} /> Unidentified Vehicle</div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: "#a78bfa", border: "1px dashed #a78bfa" }} /> Limited view (another case)</div>
              <div className="pt-2 border-t border-border mt-2">
                <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-good inline-block" /> High confidence edge</div>
                <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-warn inline-block" /> Medium confidence</div>
                <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-bad inline-block" /> Low confidence</div>
              </div>
              <div>Node color = detected community cluster</div>
            </div>

            <button onClick={() => { setSelectedNode(null); setSelectedEdge(null); unpinAll(); fgRef.current?.zoomToFit(400); }} className="mt-5 w-full text-xs px-3 py-1.5 rounded-md border border-border text-gray-300 hover:bg-[#131926]">
              Fit Graph / Reset Layout
            </button>
            <p className="mt-2 text-[10px] text-muted leading-relaxed">
              Drag any node to spread it out for a clearer view — it stays where you drop it.
              "Reset Layout" releases every dragged node back to the automatic layout.
            </p>
          </div>

          {/* Center: graph */}
          <div ref={containerRef} className="bg-[#0a0e14] border border-border rounded-lg overflow-hidden relative min-h-[500px]">
            {/* Search overlay */}
            <div className="absolute top-3 left-3 z-10 w-64">
              <input
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
                placeholder="Search a person to focus…"
                className="w-full bg-[#0f1420]/95 backdrop-blur border border-border rounded-md px-3 py-2 text-sm text-gray-100 placeholder-muted focus:outline-none focus:border-accent"
              />
              {searchOpen && searchResults.length > 0 && (
                <div className="mt-1 bg-[#0f1420] border border-border rounded-md overflow-hidden shadow-lg">
                  {searchResults.map((n: any) => (
                    <button
                      key={n.id}
                      onClick={() => focusOnNode(n)}
                      className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-[#1a2130] flex justify-between items-center"
                    >
                      <span>{n.name}</span>
                      <span className="text-muted text-[10px]">{n.subtype}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Zoom controls */}
            <div className="absolute bottom-4 right-4 z-10 flex flex-col gap-1.5">
              <button onClick={zoomIn} className="w-9 h-9 rounded-md bg-[#0f1420]/95 backdrop-blur border border-border text-gray-200 text-lg font-bold hover:bg-[#1a2130]">+</button>
              <button onClick={zoomOut} className="w-9 h-9 rounded-md bg-[#0f1420]/95 backdrop-blur border border-border text-gray-200 text-lg font-bold hover:bg-[#1a2130]">−</button>
              <button onClick={() => fgRef.current?.zoomToFit(400)} className="w-9 h-9 rounded-md bg-[#0f1420]/95 backdrop-blur border border-border text-gray-200 text-xs hover:bg-[#1a2130]">⤢</button>
            </div>

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
                if (n.subtype !== "Person") return SUBTYPE_STYLE[n.subtype]?.fill || "#f87171";
                if (neighborIds && !neighborIds.has(n.id)) return "#1f2937";
                if (n.isolated) return "#4b5563";
                if (n.access_level === "bridge") return "#a78bfa";
                return COMMUNITY_COLORS[n.community % COMMUNITY_COLORS.length];
              }}
              nodeCanvasObjectMode={(n: any) => (n.subtype === "Person" ? "after" : "replace")}
              nodeCanvasObject={(n: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
                const dimmed = neighborIds && !neighborIds.has(n.id);
                if (n.subtype === "Person") {
                  const fontSize = 11 / globalScale;
                  ctx.font = `${n.id === selectedNode?.id ? "bold " : ""}${fontSize}px Inter, sans-serif`;
                  ctx.textAlign = "center";
                  ctx.fillStyle = dimmed ? "#4b5563" : n.access_level === "bridge" ? "#c4b5fd" : "#e6e9ef";
                  ctx.fillText(n.name.split(" ")[0], n.x, n.y + 11 / globalScale);
                  if (n.access_level === "bridge" && !dimmed) {
                    // Dashed ring marks a "limited view" node - only the connection back to your
                    // case is visible, not the subject's full profile.
                    ctx.beginPath();
                    ctx.setLineDash([2 / globalScale, 2 / globalScale]);
                    ctx.arc(n.x, n.y, (5 + n.degree) + 2, 0, 2 * Math.PI);
                    ctx.strokeStyle = "#a78bfa";
                    ctx.lineWidth = 1.2 / globalScale;
                    ctx.stroke();
                    ctx.setLineDash([]);
                  }
                  if (n.id === selectedNode?.id) {
                    ctx.beginPath();
                    ctx.arc(n.x, n.y, (5 + n.degree) + 3, 0, 2 * Math.PI);
                    ctx.strokeStyle = "#22d3ee";
                    ctx.lineWidth = 1.5 / globalScale;
                    ctx.stroke();
                  }
                  return;
                }
                // Unresolved identifier: draw a colored rounded box with the raw value inside
                const style = SUBTYPE_STYLE[n.subtype] || { fill: "#f87171", text: "#1a0505" };
                const label = extractLabel(n.name);
                const fontSize = 9 / globalScale;
                ctx.font = `600 ${fontSize}px Inter, sans-serif`;
                const textW = ctx.measureText(label).width;
                const padX = 8 / globalScale;
                const padY = 5 / globalScale;
                const w = textW + padX * 2;
                const h = fontSize + padY * 2;
                ctx.fillStyle = dimmed ? "#2a2f3a" : style.fill;
                roundRect(ctx, n.x - w / 2, n.y - h / 2, w, h, 4 / globalScale);
                ctx.fill();
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillStyle = dimmed ? "#6b7280" : style.text;
                ctx.fillText(label, n.x, n.y + 0.5 / globalScale);
              }}
              linkColor={(l: any) => {
                const s = typeof l.source === "object" ? l.source.id : l.source;
                const t = typeof l.target === "object" ? l.target.id : l.target;
                const dimmed = neighborIds && !(neighborIds.has(s) && neighborIds.has(t));
                if (dimmed) return "#1f2937";
                return l.confidence_band === "High" ? "#34d399a0" : l.confidence_band === "Medium" ? "#fbbf2490" : "#f8717170";
              }}
              linkWidth={(l: any) => 0.7 + l.confidence / 35}
              linkDirectionalArrowLength={4}
              linkDirectionalArrowRelPos={1}
              linkCanvasObjectMode={() => "after"}
              linkCanvasObject={(l: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
                if (globalScale < 1.1) return; // hide labels when zoomed far out to avoid clutter
                const start = l.source, end = l.target;
                if (!start || typeof start !== "object" || !end || typeof end !== "object") return;
                const dimmed = neighborIds && !(neighborIds.has(start.id) && neighborIds.has(end.id));
                if (dimmed) return;
                const midX = (start.x + end.x) / 2;
                const midY = (start.y + end.y) / 2;
                const label = shortEdgeLabel(l.primary_type);
                const fontSize = 7.5 / globalScale;
                ctx.font = `${fontSize}px Inter, sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillStyle = "#0a0e14";
                ctx.fillText(label, midX, midY);
                ctx.fillStyle = "#9ca3af";
                ctx.fillText(label, midX, midY - 0.3 / globalScale);
              }}
              onNodeClick={(n: any) => { setSelectedEdge(null); setSelectedNode(n); setRightTab("details"); }}
              onNodeDragEnd={(n: any) => { n.fx = n.x; n.fy = n.y; }}
              onLinkClick={(l: any) => { setSelectedNode(null); setSelectedEdge(l); setRightTab("details"); }}
              onBackgroundClick={() => { setSelectedNode(null); setSelectedEdge(null); }}
              cooldownTicks={200}
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
                <div className="text-muted text-sm">Click a node or edge, or search a name above, to inspect it.</div>
              )}
              {rightTab === "details" && selectedNode && (
                <div>
                  <h3 className="text-gray-100 font-semibold mb-1">{selectedNode.name}</h3>
                  <div className="text-xs text-muted mono mb-3">{selectedNode.id} · {selectedNode.subtype}</div>
                  {selectedNode.access_level === "bridge" && (
                    <div className="mb-3 px-2 py-1.5 rounded bg-purple/10 border border-purple/30 text-purple text-xs">
                      Limited view — belongs to another case. Only their connection to yours is shown.
                    </div>
                  )}
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between"><span className="text-muted">Crime Type</span><span className="text-gray-200">{selectedNode.crime_type || "—"}</span></div>
                    <div className="flex justify-between"><span className="text-muted">Case</span><span className="text-gray-200 mono">{selectedNode.case_id || "—"}</span></div>
                    <div className="flex justify-between"><span className="text-muted">Connections</span><span className="text-gray-200 mono">{selectedNode.degree}</span></div>
                    <div className="flex justify-between"><span className="text-muted">Community</span><span className="text-gray-200 mono">{selectedNode.isolated ? "None" : `#${selectedNode.community}`}</span></div>
                  </div>
                  <Link to={`/entities/${selectedNode.id}`} className="mt-4 block text-center px-3 py-2 rounded-md bg-accent text-bg text-sm font-semibold hover:bg-accent2">
                    {selectedNode.access_level === "bridge" ? "View Limited Profile →" : "Open Full Profile →"}
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
                    {selectedEdge.evidence.map((e: any, i: number) => {
                      const ids: string[] = e.record_ids || [];
                      const evType = CATEGORY_TO_EVIDENCE[e.category] || "";
                      return (
                        <div key={i} className="text-sm border border-border rounded p-2 bg-[#0f1420]">
                          <div className="flex justify-between text-xs"><span className="text-accent">{e.label}</span><span className="text-muted mono">+{e.score}</span></div>
                          {e.examples.map((ex: string, j: number) => <div key={j} className="text-gray-400 text-xs">• {ex}</div>)}
                          {evType && ids.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {ids.slice(0, 5).map((rid: string) => (
                                <Link
                                  key={rid}
                                  to={`/evidence?evidence_type=${evType}&id=${encodeURIComponent(rid)}`}
                                  className="px-1.5 py-0.5 rounded border border-accent/30 text-accent text-[10px] mono hover:bg-accent/10"
                                  title={`Open ${evType} record ${rid}`}
                                >
                                  {rid} →
                                </Link>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
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
    </div>
  );
}