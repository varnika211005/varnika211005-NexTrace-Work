import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import { api } from "../api/client";

const SECTION_OPTIONS = [
  { key: "executive_summary", label: "Executive Summary" },
  { key: "subject_profile", label: "Subject Profile(s)" },
  { key: "network_overview", label: "Network Overview" },
  { key: "relationships", label: "Significant Relationships" },
  { key: "evidence", label: "Supporting Evidence" },
  { key: "reliability", label: "Reliability / Confidence Analysis" },
  { key: "pattern_findings", label: "Potential Pattern Findings" },
  { key: "provenance", label: "Provenance / Audit Information" },
];

interface HistoryEntry {
  filename: string;
  label: string;
  blob: Blob;
  generatedAt: string;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export default function Reports() {
  const [params] = useSearchParams();
  const [cases, setCases] = useState<any[]>([]);
  const [entities, setEntities] = useState<any[]>([]);
  const [scope, setScope] = useState<"all" | "case" | "person">(params.get("case_id") ? "case" : params.get("person_id") ? "person" : "all");
  const [caseId, setCaseId] = useState(params.get("case_id") || "");
  const [personId, setPersonId] = useState(params.get("person_id") || "");
  const [sections, setSections] = useState<Set<string>>(new Set(SECTION_OPTIONS.map((s) => s.key)));
  const [generating, setGenerating] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listCases().then(setCases).catch(() => {});
    api.listEntities().then(setEntities).catch(() => {});
  }, []);

  function toggleSection(key: string) {
    setSections((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const body: any = { sections: Array.from(sections) };
      if (scope === "case") body.case_id = caseId;
      if (scope === "person") body.person_id = personId;

      const { blob, filename } = await api.generateReport(body);
      const label = scope === "case" ? `Case ${caseId}` : scope === "person" ? entities.find((e) => e.id === personId)?.name || personId : "Full Dataset";

      triggerDownload(blob, filename);
      setHistory((h) => [{ filename, label, blob, generatedAt: new Date().toLocaleTimeString() }, ...h]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div>
      <PageHeader title="Report Generation" subtitle="Generates a PDF directly from current data — nothing is stored on the server, it downloads straight to your device." />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 bg-card border border-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-gray-100 mb-3">Scope</h3>
          <div className="flex gap-2 mb-4">
            {(["all", "case", "person"] as const).map((s) => (
              <button key={s} onClick={() => setScope(s)} className={`px-3 py-1.5 rounded-md text-xs font-medium border capitalize ${scope === s ? "bg-accent text-bg border-accent" : "border-border text-muted hover:text-gray-200"}`}>
                {s === "all" ? "Full Dataset" : s}
              </button>
            ))}
          </div>

          {scope === "case" && (
            <select value={caseId} onChange={(e) => setCaseId(e.target.value)} className="w-full bg-[#0f1420] border border-border rounded px-3 py-2 text-sm text-gray-200 mb-4">
              <option value="">Select case…</option>
              {cases.map((c) => <option key={c.case_id} value={c.case_id}>{c.case_id} — {c.title}</option>)}
            </select>
          )}
          {scope === "person" && (
            <select value={personId} onChange={(e) => setPersonId(e.target.value)} className="w-full bg-[#0f1420] border border-border rounded px-3 py-2 text-sm text-gray-200 mb-4">
              <option value="">Select subject…</option>
              {entities.filter((e) => !e.is_unresolved).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          )}

          <h3 className="text-sm font-semibold text-gray-100 mb-3 mt-2">Sections to Include</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
            {SECTION_OPTIONS.map((s) => (
              <label key={s.key} className="flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" checked={sections.has(s.key)} onChange={() => toggleSection(s.key)} />
                {s.label}
              </label>
            ))}
          </div>

          {error && <div className="mb-4 bg-bad/10 border border-bad/30 text-bad text-sm rounded-md px-3 py-2">{error}</div>}

          <button
            onClick={generate}
            disabled={generating || (scope === "case" && !caseId) || (scope === "person" && !personId) || sections.size === 0}
            className="px-5 py-2.5 rounded-md bg-accent text-bg font-semibold text-sm hover:bg-accent2 disabled:opacity-40"
          >
            {generating ? "Generating…" : "Generate & Download Report"}
          </button>
        </div>

        <div className="bg-card border border-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-gray-100 mb-3">This Session's Reports</h3>
          <p className="text-[11px] text-muted mb-3">
            Kept in your browser's memory only for this session — click to re-download without regenerating.
          </p>
          {history.length === 0 ? (
            <div className="text-muted text-sm">Reports you generate will appear here.</div>
          ) : (
            <div className="space-y-2">
              {history.map((h, i) => (
                <button
                  key={i}
                  onClick={() => triggerDownload(h.blob, h.filename)}
                  className="w-full text-left block border border-border rounded p-3 hover:border-accent/50 transition-colors"
                >
                  <div className="text-gray-200 text-sm font-medium">{h.label}</div>
                  <div className="text-muted text-xs mono mt-1">{h.filename}</div>
                  <div className="text-accent text-xs mt-1">Generated {h.generatedAt} · Download again →</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}