import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import ForceGraph2D from "react-force-graph-2d";
import { forceCollide, forceCenter } from "d3-force";
import ConfidenceBadge from "../components/ConfidenceBadge";
import { api } from "../api/client";
import "./NetworkGraph.css";

// Muted multi-hue community family — clusters read as groups without a rainbow.
const COMMUNITY_COLORS = [
  "#7aa2f7", // soft blue
  "#4ec3c8", // soft teal
  "#8b8ef0", // soft indigo
  "#8fa0b3", // slate
  "#d6a95c", // muted amber
  "#82b09a", // muted sage
  "#b98ad1", // muted orchid
  "#5d9c9a", // muted jade
];

const ACCENT = "#22d3ee";
const DIM_FILL = "#252c38";
const DIM_LABEL = "#5d6673";
const BRIDGE = "#a78bfa";

const SUBTYPE_STYLE: Record<string, { fill: string; stroke: string; text: string }> = {
  "Unknown Phone": { fill: "#0f2f29", stroke: "#2f9e72", text: "#7fe0b8" },
  "Unknown Account": { fill: "#38181f", stroke: "#d16060", text: "#f2a6a6" },
  "Unidentified Vehicle": { fill: "#2b153f", stroke: "#9a6cd6", text: "#cdb0f0" },
  Unresolved: { fill: "#23272f", stroke: "#6b7280", text: "#9ca3af" },
};

// Node subtype order used for both rendering and the "All Entities" filter menu.
const SUBTYPE_ORDER = ["Person", "Unknown Phone", "Unknown Account", "Unidentified Vehicle", "Unresolved"];

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

const CONFIDENCE_PRESETS = [0, 40, 50, 60, 70, 80, 90, 100];

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

function alpha(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function nodeRadius(n: any): number {
  if (n.subtype !== "Person") return 17;
  return 7 + Math.min((n.degree || 0) * 0.5, 9);
}

function nodeIdOf(v: any): string {
  return typeof v === "object" ? v.id : v;
}

function linkIdOf(l: any): string {
  return `${nodeIdOf(l.source)}↔${nodeIdOf(l.target)}`;
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

function subtypeIcon(subtype: string): string {
  if (subtype === "Person") return "person";
  if (subtype === "Unknown Phone") return "phone";
  if (subtype === "Unknown Account") return "account";
  if (subtype === "Unidentified Vehicle") return "vehicle";
  return "unresolved";
}

// Small canvas glyphs drawn inside nodes — no icon library, entity types are the
// ones NexTrace actually produces.
function drawGlyph(ctx: CanvasRenderingContext2D, type: string, x: number, y: number, size: number, color: string) {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  if (type === "person") {
    ctx.beginPath();
    ctx.arc(x, y - size * 0.08, size * 0.22, 0, 2 * Math.PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y + size * 0.3, size * 0.34, Math.PI, 0);
    ctx.fill();
    return;
  }
  if (type === "phone") {
    const w = size * 0.32;
    const h = size * 0.5;
    ctx.lineWidth = Math.max(1.1, size * 0.06);
    roundRect(ctx, x - w / 2, y - h / 2, w, h, size * 0.09);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + w / 2 - size * 0.07, y - h / 2 + size * 0.08, size * 0.04, 0, 2 * Math.PI);
    ctx.fill();
    return;
  }
  if (type === "account") {
    const w = size * 0.46;
    const h = size * 0.36;
    ctx.lineWidth = Math.max(1.1, size * 0.06);
    roundRect(ctx, x - w / 2, y - h / 2, w, h, size * 0.06);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - w / 2 + size * 0.06, y + size * 0.02);
    ctx.lineTo(x + w / 2 - size * 0.06, y + size * 0.02);
    ctx.stroke();
    return;
  }
  if (type === "vehicle") {
    const w = size * 0.52;
    const h = size * 0.28;
    ctx.lineWidth = Math.max(1.1, size * 0.055);
    roundRect(ctx, x - w / 2, y - size * 0.12 - h / 2, w, h, size * 0.08);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - w * 0.18, y - size * 0.12 - h / 2);
    ctx.lineTo(x - w * 0.02, y - size * 0.3);
    ctx.lineTo(x + w * 0.22, y - size * 0.3);
    ctx.lineTo(x + w * 0.3, y - size * 0.12 - h / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x - w * 0.22, y + size * 0.1, size * 0.075, 0, 2 * Math.PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + w * 0.22, y + size * 0.1, size * 0.075, 0, 2 * Math.PI);
    ctx.fill();
    return;
  }
  // unresolved — small diamond
  ctx.lineWidth = Math.max(1, size * 0.055);
  ctx.beginPath();
  ctx.moveTo(x, y - size * 0.26);
  ctx.lineTo(x + size * 0.22, y);
  ctx.lineTo(x, y + size * 0.26);
  ctx.lineTo(x - size * 0.22, y);
  ctx.closePath();
  ctx.stroke();
}

function personGlyphIcon(color: string) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="8" r="4" fill={color} />
      <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" fill={color} />
    </svg>
  );
}

function subtypeIconSvg(subtype: string, color: string) {
  if (subtype === "Unknown Phone")
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round">
        <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
        <line x1="10" y1="18" x2="14" y2="18" />
      </svg>
    );
  if (subtype === "Unknown Account")
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round">
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <line x1="2" y1="10" x2="22" y2="10" />
      </svg>
    );
  if (subtype === "Unidentified Vehicle")
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round">
        <path d="M5 15l1.5-5A2 2 0 0 1 8.4 8.6h7.2A2 2 0 0 1 17.5 10L19 15" />
        <circle cx="7.5" cy="16.5" r="1.6" fill={color} />
        <circle cx="16.5" cy="16.5" r="1.6" fill={color} />
      </svg>
    );
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v1.8M12 9v.01M12 12.5c0-1.5 2-2 2-3.5a2 2 0 1 0-4 0" transform="translate(0 3)" />
    </svg>
  );
}

// A compact dark dropdown/select control used by the top toolbar.
function FilterDropdown({
  label,
  badge,
  children,
  open,
  onToggle,
  className = "",
}: {
  label: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  open: boolean;
  onToggle: (next: boolean) => void;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onToggle(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onToggle(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onToggle]);

  return (
    <div className={`ng-dd ${className}`} ref={rootRef}>
      <button type="button" className="ng-dd-btn" onClick={() => onToggle(!open)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="ng-dd-label">{label}</span>
        {badge ? <span className="ng-dd-badge">{badge}</span> : null}
        <svg className="ng-dd-caret" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open ? <div className="ng-dd-menu" role="listbox">{children}</div> : null}
    </div>
  );
}

function statsFromAnalytics(a: any) {
  if (!a) return { nodes: "—", relationships: "—", communities: "—", bridges: "—" };
  return {
    nodes: String(a.nodes ?? "—"),
    relationships: String(a.relationships ?? "—"),
    communities: String(a.communities ?? "—"),
    bridges: String((a.bridge_entities || []).length),
  };
}

export default function NetworkGraph() {
  const [params] = useSearchParams();
  const focusId = params.get("focus");

  const [graph, setGraph] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [minConfidence, setMinConfidence] = useState(0);
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set(CATEGORY_OPTIONS.map((c) => c.key)));
  const [entityType, setEntityType] = useState<string | null>(null);
  const [communityFilter, setCommunityFilter] = useState<number | "none" | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [selectedEdge, setSelectedEdge] = useState<any>(null);
  const [hoveredEdge, setHoveredEdge] = useState<any>(null);
  const [panelMode, setPanelMode] = useState<"entity" | "relationship" | "analytics" | "path" | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [relExpanded, setRelExpanded] = useState(false);
  const [dims, setDims] = useState({ width: 800, height: 600 });
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
  const didFit = useRef(false);
  const seeded = useRef(false);

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
  }, [graph]);

  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Escape closes whichever overlay is open and clears the current selection.
  useEffect(() => {
    if (!panelOpen && !openMenu && !searchOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSelectedNode(null);
        setSelectedEdge(null);
        setPanelOpen(false);
        setPanelMode(null);
        setOpenMenu(null);
        setSearchOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen, openMenu, searchOpen]);

  useEffect(() => {
    if (focusId && graph) {
      const node = graph.nodes.find((n: any) => n.id === focusId);
      if (node) focusOnNode(node);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, graph]);

  const stats = useMemo(() => statsFromAnalytics(analytics), [analytics]);

  const entityTypes = useMemo(() => {
    if (!graph) return [];
    return SUBTYPE_ORDER.filter((t) => graph.nodes.some((n: any) => n.subtype === t));
  }, [graph]);

  const communities = useMemo(() => {
    if (!graph) return [];
    const set = new Set<number>();
    graph.nodes.forEach((n: any) => {
      if (!n.isolated && typeof n.community === "number") set.add(n.community);
    });
    return [...set].sort((a, b) => a - b);
  }, [graph]);

  const graphData = useMemo(() => {
    if (!graph) return { nodes: [], links: [] };
    const nodes = graph.nodes.filter((n: any) => {
      if (entityType && n.subtype !== entityType) return false;
      if (communityFilter === "none" && !n.isolated) return false;
      if (typeof communityFilter === "number" && (n.isolated || n.community !== communityFilter)) return false;
      return true;
    });
    const idSet = new Set(nodes.map((n: any) => n.id));
    const links = graph.edges.filter(
      (e: any) =>
        e.confidence >= minConfidence &&
        e.evidence.some((ev: any) => activeCategories.has(ev.category)) &&
        idSet.has(nodeIdOf(e.source)) &&
        idSet.has(nodeIdOf(e.target))
    );
    return { nodes: nodes.map((n: any) => ({ ...n })), links: links.map((e: any) => ({ ...e })) };
  }, [graph, minConfidence, activeCategories, entityType, communityFilter]);

  // Seed the first layout across the canvas in a gentle community-spiral so nodes
  // start spread out instead of clumping, then let the forces refine it.
  useEffect(() => {
    const nodes = graphData.nodes;
    if (nodes.length < 3 || seeded.current) return;
    seeded.current = true;
    const maxR = Math.min(dims.width || 800, dims.height || 600) * 0.44;
    const n = nodes.length;
    nodes.forEach((node: any, i: number) => {
      const t = i / Math.max(n - 1, 1);
      const angle = t * Math.PI * 2.4 + (node.community >= 0 ? node.community * 1.1 : 0);
      const r = 40 + t * maxR * 0.92;
      node.x = Math.cos(angle) * r;
      node.y = Math.sin(angle) * r;
    });
  }, [graphData, dims]);

  // Force layout tuning — spread the network out (existing simulation, new parameters).
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || graphData.nodes.length === 0) return;
    const charge = fg.d3Force("charge");
    if (charge) charge.strength(-420).distanceMax(1200);
    const link = fg.d3Force("link");
    if (link) {
      link.distance((l: any) => 130 + (nodeRadius(l.source) + nodeRadius(l.target)) * 0.6).strength(0.1);
      link.iterations(2);
    }
    fg.d3Force("collide", forceCollide((n: any) => nodeRadius(n) + 24));
    const center = fg.d3Force("center");
    if (center) center.strength(0.05);
    else fg.d3Force("center", forceCenter(0, 0).strength(0.05));
    fg.d3ReheatSimulation();
  }, [graphData]);

  // Auto-fit to the canvas once on load.
  useEffect(() => {
    if (!fgRef.current || graphData.nodes.length === 0 || didFit.current) return;
    didFit.current = true;
    const t = setTimeout(() => fgRef.current?.zoomToFit(600, 80), 1400);
    return () => clearTimeout(t);
  }, [graphData]);

  // Re-fit when the entity/community filters narrow the visible set.
  const prevFilter = useRef<{ entity: string | null; community: number | "none" | null }>({ entity: null, community: null });
  useEffect(() => {
    if (graphData.nodes.length === 0) return;
    const prev = prevFilter.current;
    if (prev.entity !== entityType || prev.community !== communityFilter) {
      const t = setTimeout(() => fgRef.current?.zoomToFit(400, 90), 700);
      return () => clearTimeout(t);
    }
    prevFilter.current = { entity: entityType, community: communityFilter };
  }, [entityType, communityFilter, graphData]);

  const neighborIds = useMemo(() => {
    if (!selectedNode || !graph) return null;
    const ids = new Set<string>([selectedNode.id]);
    graphData.links.forEach((e: any) => {
      const s = nodeIdOf(e.source);
      const t = nodeIdOf(e.target);
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

  const directRels = useMemo(() => {
    if (!selectedNode) return [];
    const rels: any[] = [];
    graphData.links.forEach((l: any) => {
      const s = nodeIdOf(l.source);
      const t = nodeIdOf(l.target);
      if (s === selectedNode.id || t === selectedNode.id) {
        const otherId = s === selectedNode.id ? t : s;
        const other = graphData.nodes.find((n: any) => n.id === otherId);
        rels.push({
          id: otherId,
          name: other?.name || otherId,
          subtype: other?.subtype || "Person",
          type: shortEdgeLabel(l.primary_type),
          confidence: l.confidence,
        });
      }
    });
    return rels.sort((a, b) => b.confidence - a.confidence);
  }, [selectedNode, graphData]);

  const sortedPersons = useMemo(
    () =>
      graph
        ? [...graph.nodes].filter((n: any) => n.subtype === "Person").sort((a: any, b: any) => a.name.localeCompare(b.name))
        : [],
    [graph]
  );

  const panelKey = useMemo(() => {
    if (panelMode === "entity" && selectedNode) return `entity:${selectedNode.id}`;
    if (panelMode === "relationship" && selectedEdge) return `edge:${linkIdOf(selectedEdge)}`;
    return panelMode || "none";
  }, [panelMode, selectedNode, selectedEdge]);

  const selectionVisible = panelMode === "entity" || panelMode === "relationship";
  const overlayLabel =
    panelMode === "analytics" ? "Analytics panel" : panelMode === "path" ? "Path analysis panel" : "Entity context panel";

  function openPanel(mode: "entity" | "relationship" | "analytics" | "path") {
    setPanelMode(mode);
    setPanelOpen(true);
    setOpenMenu(null);
    setRelExpanded(false);
  }

  function closePanel() {
    setSelectedNode(null);
    setSelectedEdge(null);
    setPanelMode(null);
    setPanelOpen(false);
    setRelExpanded(false);
  }

  function toggleCategory(key: string) {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function resetFilters() {
    setEntityType(null);
    setCommunityFilter(null);
    setMinConfidence(0);
    setActiveCategories(new Set(CATEGORY_OPTIONS.map((c) => c.key)));
    closePanel();
  }

  function focusOnNode(node: any) {
    setSelectedEdge(null);
    setSelectedNode(node);
    openPanel("entity");
    setSearchOpen(false);
    setSearchQuery(node.name);
    const doFocus = () => {
      const liveNode = fgRef.current?.graphData?.().nodes?.find((n: any) => n.id === node.id) || node;
      if (liveNode && liveNode.x !== undefined) {
        fgRef.current?.centerAt(liveNode.x + dims.width * 0.04, liveNode.y, 300);
        fgRef.current?.zoom(3.6, 300);
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

  function resetLayout() {
    closePanel();
    unpinAll();
    fgRef.current?.zoomToFit(400, 80);
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

  // ---- minimap ----
  const minimapRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = minimapRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function project() {
      const nodes = graphData.nodes.filter((n: any) => typeof n.x === "number");
      if (!nodes.length) return null;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      nodes.forEach((n: any) => {
        if (n.x < minX) minX = n.x;
        if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
      });
      const pad = 60;
      const bw = Math.max(maxX - minX, 1);
      const bh = Math.max(maxY - minY, 1);
      const scale = Math.min((canvas.width - 8) / bw, (canvas.height - 8) / bh);
      const ox = (canvas.width - bw * scale) / 2 - minX * scale;
      const oy = (canvas.height - bh * scale) / 2 - minY * scale;
      return { scale, ox, oy };
    }

    let raf = 0;
    const loop = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const p = project();
      const px = (x: number) => x * p.scale + p.ox;
      const py = (y: number) => y * p.scale + p.oy;
      const cW = canvas.width;
      const cH = canvas.height;
      if (p) {
        ctx.fillStyle = "rgba(7,11,18,0.86)";
        ctx.fillRect(0, 0, cW, cH);
        graphData.links.forEach((l: any) => {
          const s = l.source;
          const t = l.target;
          if (typeof s?.x === "number" && typeof t?.x === "number") {
            ctx.strokeStyle = "rgba(120,135,160,0.16)";
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(px(s.x), py(s.y));
            ctx.lineTo(px(t.x), py(t.y));
            ctx.stroke();
          }
        });
        graphData.nodes.forEach((n: any) => {
          if (typeof n.x !== "number") return;
          const dim = selectedNode && n.id !== selectedNode.id;
          ctx.beginPath();
          ctx.arc(px(n.x), py(n.y), n.id === selectedNode?.id ? 2.6 : 1.6, 0, 2 * Math.PI);
          ctx.fillStyle = dim
            ? "#3a4454"
            : n.access_level === "bridge"
              ? BRIDGE
              : n.community >= 0
                ? COMMUNITY_COLORS[n.community % COMMUNITY_COLORS.length]
                : "#8fa0b3";
          ctx.fill();
        });
        // current viewport
        try {
          const fg = fgRef.current;
          if (fg && typeof fg.zoom === "function" && dims.width > 0) {
            const tl = fg.screen2GraphCoords(0, 0);
            const br = fg.screen2GraphCoords(dims.width, dims.height);
            ctx.strokeStyle = "rgba(34,211,238,0.8)";
            ctx.lineWidth = 1;
            ctx.strokeRect(px(tl[0]), py(tl[1]), px(br[0]) - px(tl[0]), py(br[1]) - py(tl[1]));
          }
        } catch {
          /* not ready yet */
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [graphData, dims, selectedNode]);

  function minimapClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = minimapRef.current;
    const fg = fgRef.current;
    if (!canvas || !fg) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const nodes = graphData.nodes.filter((n: any) => typeof n.x === "number");
    if (!nodes.length) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach((n: any) => {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y);
    });
    const bw = Math.max(maxX - minX, 1);
    const bh = Math.max(maxY - minY, 1);
    const scale = Math.min((canvas.width - 8) / bw, (canvas.height - 8) / bh);
    const gx = (mx - (canvas.width - bw * scale) / 2) / scale + minX;
    const gy = (my - (canvas.height - bh * scale) / 2) / scale + minY;
    fg.centerAt(gx, gy, 250);
  }

  if (error) return <div className="text-bad text-sm">{error}</div>;
  if (!graph) return <div className="text-muted text-sm">Loading graph…</div>;

  if (graph.nodes.length === 0) {
    return (
      <div>
        <h1 className="text-lg font-semibold text-gray-100 mb-3">Network Analysis</h1>
        <div className="bg-card border border-border rounded-lg p-10 text-center text-muted text-sm">
          No data yet.{" "}
          <Link to="/admin/ingestion" className="text-accent underline">
            Go to Data Ingestion
          </Link>
        </div>
      </div>
    );
  }

  const activeCatCount = activeCategories.size;
  const relFilterOpen = openMenu === "relationships";
  const activeItemClass = "ng-dd-item ng-dd-active";

  return (
    <div ref={outerRef} className={`network-page ${isFullscreen ? "bg-bg h-screen flex flex-col p-4" : "h-full flex flex-col min-h-0"}`}>
      <div className="flex-1 flex flex-col min-h-0 gap-2">
        {/* ---- Top toolbar (compact filters + actions) ---- */}
        <div className="ng-toolbar flex flex-wrap items-center gap-2">
          <span className="ng-brand">Network Analysis</span>

          <div className="ng-searchbox relative">
            <svg className="ng-search-icon pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Search a person to focus…"
              className="ng-search-input"
            />
            {searchOpen && searchResults.length > 0 && (
              <div className="ng-results">
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

          <FilterDropdown
            label={entityType || "All Entities"}
            open={openMenu === "entities"}
            onToggle={(v) => setOpenMenu(v ? "entities" : null)}
          >
            <button type="button" className={entityType === null ? activeItemClass : "ng-dd-item"} onClick={() => { setEntityType(null); setOpenMenu(null); }}>
              All Entities
            </button>
            {entityTypes.map((t) => (
              <button
                key={t}
                type="button"
                className={entityType === t ? activeItemClass : "ng-dd-item"}
                onClick={() => { setEntityType(entityType === t ? null : t); setOpenMenu(null); }}
              >
                {t}
              </button>
            ))}
          </FilterDropdown>

          <FilterDropdown
            label={activeCatCount < CATEGORY_OPTIONS.length ? `${activeCatCount} relationship${activeCatCount === 1 ? "" : "s"}` : "All Relationships"}
            badge={activeCatCount < CATEGORY_OPTIONS.length ? String(activeCatCount) : undefined}
            open={relFilterOpen}
            onToggle={(v) => setOpenMenu(v ? "relationships" : null)}
          >
            <button
              type="button"
              className={activeCatCount === CATEGORY_OPTIONS.length ? activeItemClass : "ng-dd-item"}
              onClick={() => {
                setActiveCategories(new Set(CATEGORY_OPTIONS.map((c) => c.key)));
                setOpenMenu(null);
              }}
            >
              All Relationships
            </button>
            {CATEGORY_OPTIONS.map((c) => (
              <label key={c.key} className="ng-dd-item ng-dd-check">
                <input type="checkbox" checked={activeCategories.has(c.key)} onChange={() => toggleCategory(c.key)} />
                <span>{c.label}</span>
              </label>
            ))}
            <div className="ng-dd-footer">
              <button type="button" onClick={() => setOpenMenu(null)} className="ng-dd-done">
                Done
              </button>
            </div>
          </FilterDropdown>

          <FilterDropdown
            label={minConfidence > 0 ? `Min ${minConfidence}%` : "Min. Confidence"}
            open={openMenu === "confidence"}
            onToggle={(v) => setOpenMenu(v ? "confidence" : null)}
          >
            {CONFIDENCE_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                className={minConfidence === c ? activeItemClass : "ng-dd-item"}
                onClick={() => { setMinConfidence(c); setOpenMenu(null); }}
              >
                {c === 0 ? "All (0%)" : `${c}%`}
              </button>
            ))}
          </FilterDropdown>

          <FilterDropdown
            label={communityFilter === "none" ? "No Community" : typeof communityFilter === "number" ? `Community ${communityFilter}` : "All Communities"}
            open={openMenu === "communities"}
            onToggle={(v) => setOpenMenu(v ? "communities" : null)}
          >
            <button
              type="button"
              className={communityFilter === null ? activeItemClass : "ng-dd-item"}
              onClick={() => { setCommunityFilter(null); setOpenMenu(null); }}
            >
              All Communities
            </button>
            {communities.map((c) => (
              <button
                key={c}
                type="button"
                className={communityFilter === c ? activeItemClass : "ng-dd-item"}
                onClick={() => { setCommunityFilter(communityFilter === c ? null : c); setOpenMenu(null); }}
              >
                Community {c}
              </button>
            ))}
            <button
              type="button"
              className={communityFilter === "none" ? activeItemClass : "ng-dd-item"}
              onClick={() => { setCommunityFilter(communityFilter === "none" ? null : "none"); setOpenMenu(null); }}
            >
              None (isolated)
            </button>
          </FilterDropdown>

          <button type="button" className="ng-btn" onClick={resetFilters}>
            Reset
          </button>

          <div className="ng-tool-actions ml-auto flex items-center gap-2">
            <button type="button" className="ng-btn" onClick={() => openPanel("path")}>
              Find Path
            </button>
            <button type="button" className="ng-btn" onClick={() => openPanel("analytics")}>
              Analytics
            </button>
            <button type="button" className="ng-btn" onClick={toggleFullscreen} title="Toggle fullscreen">
              {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            </button>
          </div>
        </div>

        {/* ---- Compact statistics strip ---- */}
        <div className="ng-stats">
          <div className="ng-stat"><span className="ng-stat-value">{stats.nodes}</span><span className="ng-stat-label">Nodes</span></div>
          <div className="ng-stat"><span className="ng-stat-value">{stats.relationships}</span><span className="ng-stat-label">Relationships</span></div>
          <div className="ng-stat"><span className="ng-stat-value">{stats.communities}</span><span className="ng-stat-label">Communities</span></div>
          <div className="ng-stat"><span className="ng-stat-value">{stats.bridges}</span><span className="ng-stat-label">Bridge Entities</span></div>
        </div>

        {/* ---- Graph shell (dominant) ---- */}
        <div ref={containerRef} className="ng-graph-shell bg-[#070b12] border border-border rounded-lg overflow-hidden relative flex-1 min-h-0">
          <div className="ng-bg pointer-events-none absolute inset-0 z-[5]" aria-hidden="true">
            <div className="ng-bg-grid absolute inset-0" />
            <div className="ng-bg-glow absolute inset-0" data-active={selectionVisible ? "1" : undefined} />
            <div className="ng-bg-vignette absolute inset-0" />
          </div>

          <ForceGraph2D
            ref={fgRef}
            graphData={graphData as any}
            width={dims.width}
            height={dims.height}
            backgroundColor="#070b12"
            nodeId="id"
            nodeLabel={(n: any) => `${n.name} (${n.subtype})`}
            nodeRelSize={5}
            nodeVal={(n: any) => 2 + n.degree}
            nodeColor={(n: any) => {
              if (n.subtype !== "Person") return SUBTYPE_STYLE[n.subtype]?.stroke || "#f87171";
              if (neighborIds && !neighborIds.has(n.id)) return DIM_FILL;
              if (n.isolated) return "#4b5563";
              if (n.access_level === "bridge") return BRIDGE;
              return n.community >= 0 ? COMMUNITY_COLORS[n.community % COMMUNITY_COLORS.length] : COMMUNITY_COLORS[3];
            }}
            nodeCanvasObjectMode={(n: any) => (n.subtype === "Person" ? "after" : "replace")}
            nodeCanvasObject={(n: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
              const dimmed = neighborIds && !neighborIds.has(n.id);
              const isSelected = n.id === selectedNode?.id;
              const isNeighbor = neighborIds?.has(n.id) === true && !isSelected;
              const x = n.x, y = n.y;

              if (n.subtype === "Person") {
                const r = nodeRadius(n);
                const base = n.access_level === "bridge" ? BRIDGE : n.community >= 0 ? COMMUNITY_COLORS[n.community % COMMUNITY_COLORS.length] : COMMUNITY_COLORS[3];
                const ring = isSelected ? ACCENT : base;
                const labelColor = isSelected ? "#67e8f9" : dimmed ? DIM_LABEL : n.access_level === "bridge" ? "#c4b5fd" : "#d7dee8";

                if (!dimmed) {
                  ctx.beginPath();
                  ctx.arc(x, y, r + 7, 0, 2 * Math.PI);
                  ctx.fillStyle = alpha(ring, isSelected ? 0.18 : 0.08);
                  ctx.fill();
                }
                ctx.beginPath();
                ctx.arc(x, y, r, 0, 2 * Math.PI);
                ctx.fillStyle = alpha(ring, dimmed ? 0.13 : 0.2);
                ctx.fill();
                ctx.strokeStyle = alpha(ring, dimmed ? 0.5 : 0.95);
                ctx.lineWidth = (isSelected ? 2.4 : 1.4) / globalScale;
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(x, y, Math.max(2.4, r * 0.42), 0, 2 * Math.PI);
                ctx.fillStyle = alpha(ring, dimmed ? 0.6 : 0.95);
                ctx.fill();
                // glyph icon
                drawGlyph(ctx, "person", x, y, r * 0.62, alpha(ring, dimmed ? 0.5 : 0.92));
                if (isNeighbor) {
                  ctx.beginPath();
                  ctx.arc(x, y, r + 3.5, 0, 2 * Math.PI);
                  ctx.strokeStyle = alpha(ACCENT, 0.35);
                  ctx.lineWidth = 1 / globalScale;
                  ctx.stroke();
                }
                if (n.access_level === "bridge" && !dimmed) {
                  ctx.beginPath();
                  ctx.setLineDash([3 / globalScale, 3 / globalScale]);
                  ctx.arc(x, y, r + 9, 0, 2 * Math.PI);
                  ctx.strokeStyle = alpha("#a78bfa", 0.8);
                  ctx.lineWidth = 1.2 / globalScale;
                  ctx.stroke();
                  ctx.setLineDash([]);
                }

                const label = n.name.split(" ")[0];
                const fs = (isSelected ? 12 : 10.5) / globalScale;
                ctx.font = `${isSelected ? "600" : "500"} ${fs}px Inter, sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                const tw = ctx.measureText(label).width;
                const ly = y + r + 9 / globalScale + fs * 0.4;
                const padX = 6 / globalScale;
                const padY = 2.5 / globalScale;
                roundRect(ctx, x - tw / 2 - padX, ly - fs / 2 - padY, tw + padX * 2, fs + padY * 2, 4 / globalScale);
                ctx.fillStyle = "rgba(4,8,14,0.78)";
                ctx.fill();
                if (isSelected) {
                  ctx.strokeStyle = alpha(ACCENT, 0.5);
                  ctx.lineWidth = 1 / globalScale;
                  ctx.stroke();
                }
                ctx.fillStyle = labelColor;
                ctx.fillText(label, x, ly);
                return;
              }

              const style = SUBTYPE_STYLE[n.subtype] || SUBTYPE_STYLE.Unresolved;
              const label = extractLabel(n.name);
              const fontSize = 9 / globalScale;
              ctx.font = `600 ${fontSize}px Inter, sans-serif`;
              const textW = ctx.measureText(label).width;
              const padX = 8 / globalScale;
              const padY = 4.5 / globalScale;
              const w = textW + padX * 2 + 10 / globalScale;
              const h = fontSize + padY * 2;
              if (!dimmed) {
                roundRect(ctx, x - w / 2 - 4, y - h / 2 - 4, w + 8, h + 8, 8 / globalScale);
                ctx.fillStyle = alpha(style.stroke, 0.07);
                ctx.fill();
              }
              roundRect(ctx, x - w / 2, y - h / 2, w, h, 6 / globalScale);
              ctx.fillStyle = dimmed ? DIM_FILL : style.fill;
              ctx.fill();
              ctx.strokeStyle = isSelected ? alpha(ACCENT, 0.95) : dimmed ? "#3d4754" : alpha(style.stroke, 0.9);
              ctx.lineWidth = (isSelected ? 1.8 : 1.2) / globalScale;
              ctx.stroke();
              drawGlyph(ctx, subtypeIcon(n.subtype), x - w / 2 + 9 / globalScale, y, 9, alpha(isSelected ? ACCENT : style.stroke, 0.95));
              ctx.textAlign = "left";
              ctx.textBaseline = "middle";
              ctx.fillStyle = dimmed ? DIM_LABEL : style.text;
              ctx.fillText(label, x - w / 2 + 15 / globalScale, y + 0.5 / globalScale);
            }}
            linkColor={(l: any) => {
              const s = nodeIdOf(l.source);
              const t = nodeIdOf(l.target);
              const dimmed = neighborIds && !(neighborIds.has(s) && neighborIds.has(t));
              if (l === hoveredEdge || l === selectedEdge) return ACCENT;
              if (dimmed) return "#1e2530";
              return l.confidence_band === "High" ? "#2fbf8a" : l.confidence_band === "Medium" ? "#c8913f" : "#c05b5b";
            }}
            linkWidth={(l: any) => (l === hoveredEdge || l === selectedEdge ? 2.4 : 0.5 + l.confidence / 100)}
            linkLabel={(l: any) => `${l.primary_type} · ${l.confidence}% confidence`}
            linkDirectionalArrowLength={4}
            linkDirectionalArrowRelPos={1}
            linkCurvature={0.04}
            linkCanvasObjectMode={() => "after"}
            linkCanvasObject={(l: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
              if (globalScale < 0.8) return;
              const start = l.source, end = l.target;
              if (!start || typeof start !== "object" || !end || typeof end !== "object") return;
              const dimmed = neighborIds && !(neighborIds.has(start.id) && neighborIds.has(end.id));
              if (dimmed) return;
              const emphasized = l === hoveredEdge || l === selectedEdge;
              const midX = (start.x + end.x) / 2;
              const midY = (start.y + end.y) / 2;
              const label = shortEdgeLabel(l.primary_type);
              const fs = emphasized ? 8.5 / globalScale : 7.5 / globalScale;
              ctx.font = `${emphasized ? "600" : "500"} ${fs}px Inter, sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              const tw = ctx.measureText(label).width;
              const padX = 5.5 / globalScale;
              const padY = 3 / globalScale;
              const pillW = tw + padX * 2;
              const pillH = fs + padY * 2;
              roundRect(ctx, midX - pillW / 2, midY - pillH / 2, pillW, pillH, 4.5 / globalScale);
              ctx.fillStyle = emphasized ? "rgba(8,20,28,0.9)" : "rgba(5,9,15,0.72)";
              ctx.fill();
              ctx.strokeStyle = emphasized ? alpha(ACCENT, 0.6) : "rgba(120,135,160,0.28)";
              ctx.lineWidth = 1 / globalScale;
              ctx.stroke();
              ctx.fillStyle = emphasized ? "#7dd3fc" : "#aab6c8";
              ctx.fillText(label, midX, midY + 0.5 / globalScale);
            }}
            onNodeClick={(n: any) => {
              setSelectedEdge(null);
              setSelectedNode(n);
              openPanel("entity");
            }}
            onNodeDragEnd={(n: any) => {
              n.fx = n.x;
              n.fy = n.y;
            }}
            onLinkClick={(l: any) => {
              setSelectedNode(null);
              setSelectedEdge(l);
              openPanel("relationship");
            }}
            onLinkHover={(l: any) => setHoveredEdge(l)}
            onBackgroundClick={() => closePanel()}
            cooldownTicks={300}
          />

          {/* ---- Legend (bottom-left) ---- */}
          <div className="ng-legend">
            <div className="ng-legend-group">
              <div className="ng-legend-title">Entity Type</div>
              <div className="flex items-center gap-1.5"><span className="ng-swatch ng-swatch-person" /> Person</div>
              <div className="flex items-center gap-1.5"><span className="ng-swatch ng-swatch-box" style={{ "--sw": "#2f9e72" } as any} /> Phone</div>
              <div className="flex items-center gap-1.5"><span className="ng-swatch ng-swatch-box" style={{ "--sw": "#d16060" } as any} /> Account</div>
              <div className="flex items-center gap-1.5"><span className="ng-swatch ng-swatch-box" style={{ "--sw": "#9a6cd6" } as any} /> Vehicle</div>
              <div className="flex items-center gap-1.5"><span className="ng-swatch ng-swatch-bridge" /> Bridge entity</div>
            </div>
            <div className="ng-legend-divider" />
            <div className="ng-legend-group">
              <div className="ng-legend-title">Relationship</div>
              <div className="flex items-center gap-1.5"><span className="ng-swatch-conf ng-swatch-high" /> High confidence</div>
              <div className="flex items-center gap-1.5"><span className="ng-swatch-conf ng-swatch-med" /> Medium</div>
              <div className="flex items-center gap-1.5"><span className="ng-swatch-conf ng-swatch-low" /> Low</div>
            </div>
            <div className="ng-legend-note">Node colour = community</div>
          </div>

          {/* ---- Minimap + zoom controls (bottom-right) ---- */}
          <div className="ng-minimap-wrap">
            <canvas ref={minimapRef} width={170} height={118} className="ng-minimap" onClick={minimapClick} aria-label="Graph minimap" />
            <div className="ng-mini-controls">
              <button onClick={zoomIn} aria-label="Zoom in" title="Zoom in" className="ng-control w-7 h-7">+</button>
              <button onClick={zoomOut} aria-label="Zoom out" title="Zoom out" className="ng-control w-7 h-7">−</button>
              <button onClick={resetLayout} aria-label="Fit graph" title="Fit graph (reset layout)" className="ng-control w-7 h-7 text-[11px]">⤢</button>
            </div>
          </div>

          {/* ---- Right overlay panel (entity / relationship / analytics / path) ---- */}
          <div
            role="region"
            aria-label={overlayLabel}
            aria-hidden={!panelOpen}
            className={`ng-overlay absolute top-3 right-3 bottom-3 z-20 transition-all duration-300 ease-out ${
              panelOpen ? "visible opacity-100 translate-x-0 pointer-events-auto" : "invisible opacity-0 translate-x-[115%] pointer-events-none"
            }`}
          >
            <div className="h-full flex flex-col bg-card/95 backdrop-blur border border-border rounded-lg shadow-2xl overflow-hidden">
              <div className="ng-panel-head flex items-center gap-2.5 px-3.5 py-2.5 border-b border-border shrink-0">
                {selectionVisible && (
                  <span
                    className="ng-avatar shrink-0"
                    style={{
                      "--ac": selectedNode
                        ? selectedNode.community >= 0
                          ? COMMUNITY_COLORS[selectedNode.community % COMMUNITY_COLORS.length]
                          : "#8fa0b3"
                        : "#8fa0b3",
                    } as any}
                  >
                    {selectedNode ? (
                      selectedNode.subtype === "Person" ? (
                        personGlyphIcon("#0a0e14")
                      ) : (
                        subtypeIconSvg(selectedNode.subtype, "#0a0e14")
                      )
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <circle cx="12" cy="8" r="4" fill="#0a0e14" />
                        <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" fill="#0a0e14" />
                      </svg>
                    )}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="ng-panel-title text-gray-100 font-semibold truncate leading-tight">
                    {panelMode === "entity" && selectedNode
                      ? selectedNode.name
                      : panelMode === "relationship" && selectedEdge
                        ? "Relationship"
                        : panelMode === "analytics"
                          ? "Graph Analytics"
                          : "Find Path"}
                  </div>
                  <div className="ng-panel-sub text-muted text-[10px] truncate">
                    {panelMode === "entity" && selectedNode
                      ? selectedNode.subtype
                      : panelMode === "relationship" && selectedEdge
                        ? `${(selectedEdge.source as any).name} ↔ ${(selectedEdge.target as any).name}`
                        : panelMode === "analytics"
                          ? "Network summary · actual data"
                          : "Path between two entities"}
                  </div>
                </div>
                <button onClick={closePanel} aria-label="Close panel" title="Close panel (Esc)" className="ng-close shrink-0">
                  ✕
                </button>
              </div>

              <div key={panelKey} className="network-slide-in flex-1 min-h-0 overflow-y-auto p-3.5">
                {/* ---- Entity profile ---- */}
                {panelMode === "entity" && selectedNode && (
                  <div>
                    {selectedNode.access_level === "bridge" && (
                      <div className="ng-bridge-notice mb-2.5 px-2 py-1.5 rounded bg-purple/10 border border-purple/30 text-purple text-xs">
                        Limited view — belongs to another case. Only the connection to yours is shown.
                      </div>
                    )}
                    <div className="ng-meta">
                      <div className="ng-meta-row"><span className="ng-meta-key">Entity ID</span><span className="ng-meta-val mono">{selectedNode.id}</span></div>
                      <div className="ng-meta-row"><span className="ng-meta-key">Community</span><span className="ng-meta-val mono">{selectedNode.isolated ? "None" : `#${selectedNode.community}`}</span></div>
                      {selectedNode.crime_type ? (
                        <div className="ng-meta-row"><span className="ng-meta-key">Crime Type</span><span className="ng-meta-val">{selectedNode.crime_type}</span></div>
                      ) : null}
                      {selectedNode.case_id ? (
                        <div className="ng-meta-row"><span className="ng-meta-key">Case</span><span className="ng-meta-val mono">{selectedNode.case_id}</span></div>
                      ) : null}
                      <div className="ng-meta-row"><span className="ng-meta-key">Connections</span><span className="ng-meta-val mono">{selectedNode.degree}</span></div>
                    </div>

                    <div className="ng-section">
                      <div className="flex items-center justify-between mb-1.5">
                        <h4 className="ng-section-heading text-xs font-semibold uppercase tracking-wider text-muted">Direct Relationships</h4>
                        {directRels.length > 8 && (
                          <button type="button" className="text-[10px] text-accent hover:underline" onClick={() => setRelExpanded((v) => !v)}>
                            {relExpanded ? "Show Less" : "View All"}
                          </button>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {(relExpanded ? directRels : directRels.slice(0, 8)).map((r) => (
                          <button
                            key={r.id}
                            onClick={() => focusOnNode(graph.nodes.find((n: any) => n.id === r.id))}
                            title={`Focus ${r.name}`}
                            className="ng-rel-row w-full text-left flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-[#0f1420] border border-border hover:border-accent/40 text-xs"
                          >
                            <span className="min-w-0">
                              <span className="text-gray-200 truncate block leading-tight">{r.name}</span>
                              <span className="text-muted text-[10px] block">{r.subtype} · {r.type}</span>
                            </span>
                            <span className={`mono shrink-0 ${r.confidence >= 70 ? "text-good" : r.confidence >= 40 ? "text-warn" : "text-bad"}`}>{r.confidence}%</span>
                          </button>
                        ))}
                        {directRels.length === 0 && <div className="text-muted text-xs">No relationships in the current view.</div>}
                      </div>
                    </div>

                    <Link to={`/entities/${selectedNode.id}`} className="ng-cta mt-3 block text-center px-3 py-2 rounded-md bg-accent text-bg text-sm font-semibold hover:bg-accent2">
                      View Full Profile →
                    </Link>
                  </div>
                )}

                {/* ---- Relationship detail ---- */}
                {panelMode === "relationship" && selectedEdge && (
                  <div>
                    <div className="text-sm text-gray-300 mb-2">
                      {(selectedEdge.source as any).name || selectedEdge.source}{" "}
                      <span className="text-accent">↔</span>{" "}
                      {(selectedEdge.target as any).name || selectedEdge.target}
                    </div>
                    <div className="mb-3"><ConfidenceBadge score={selectedEdge.confidence} band={selectedEdge.confidence_band} size="md" /></div>
                    <div className="text-xs text-muted mb-1">Primary Type</div>
                    <div className="text-sm text-gray-200 mb-3">{selectedEdge.primary_type}</div>
                    <div className="ng-section-heading text-xs text-muted uppercase tracking-wider mb-1.5">Supporting Evidence</div>
                    <div className="space-y-2">
                      {selectedEdge.evidence.map((e: any, i: number) => {
                        const ids: string[] = e.record_ids || [];
                        const evType = CATEGORY_TO_EVIDENCE[e.category] || "";
                        return (
                          <div key={i} className="ng-evidence text-sm border border-border rounded p-2 bg-[#0f1420]">
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

                {/* ---- Analytics ---- */}
                {panelMode === "analytics" && analytics && (
                  <div className="space-y-3 text-sm">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-[#0f1420] border border-border rounded p-2 text-center"><div className="text-lg font-bold mono text-gray-100">{analytics.nodes}</div><div className="text-[10px] text-muted uppercase">Nodes</div></div>
                      <div className="bg-[#0f1420] border border-border rounded p-2 text-center"><div className="text-lg font-bold mono text-gray-100">{analytics.relationships}</div><div className="text-[10px] text-muted uppercase">Relationships</div></div>
                      <div className="bg-[#0f1420] border border-border rounded p-2 text-center"><div className="text-lg font-bold mono text-gray-100">{analytics.communities}</div><div className="text-[10px] text-muted uppercase">Communities</div></div>
                      <div className="bg-[#0f1420] border border-border rounded p-2 text-center"><div className="text-lg font-bold mono text-gray-100">{analytics.density}</div><div className="text-[10px] text-muted uppercase">Density</div></div>
                    </div>
                    <div>
                      <div className="ng-section-heading text-xs text-muted uppercase tracking-wider mb-2">Central Entities</div>
                      {analytics.central_entities.map((c: any) => (
                        <Link key={c.id} to={`/entities/${c.id}`} className="flex justify-between py-1 text-gray-300 hover:text-accent text-xs">
                          <span className="truncate">{c.name}</span><span className="mono text-muted">{c.degree}</span>
                        </Link>
                      ))}
                    </div>
                    <div>
                      <div className="ng-section-heading text-xs text-muted uppercase tracking-wider mb-2 mt-3">Bridge Entities</div>
                      {analytics.bridge_entities.map((b: any) => (
                        <Link key={b.id} to={`/entities/${b.id}`} className="block py-1 text-gray-300 hover:text-accent text-xs">{b.name}</Link>
                      ))}
                    </div>
                  </div>
                )}

                {/* ---- Path ---- */}
                {panelMode === "path" && (
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
    </div>
  );
}