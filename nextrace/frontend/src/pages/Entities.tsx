import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import { api } from "../api/client";

export default function Entities() {
  const [entities, setEntities] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeUnresolved, setIncludeUnresolved] = useState(false);

  function load(query?: string) {
    setLoading(true);
    api
      .listEntities({ ...(query ? { q: query } : {}), include_unresolved: String(includeUnresolved) })
      .then(setEntities)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeUnresolved]);

  return (
    <div>
      <PageHeader title="Entities" subtitle="Search subjects by name, alias, phone number, or case ID." />

      <div className="flex gap-3 mb-5 items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load(q)}
          placeholder="Search entity, identifier, alias, case…"
          className="flex-1 bg-card border border-border rounded-md px-4 py-2.5 text-sm text-gray-100 placeholder-muted focus:outline-none focus:border-accent"
        />
        <label className="flex items-center gap-2 text-xs text-muted whitespace-nowrap">
          <input type="checkbox" checked={includeUnresolved} onChange={(e) => setIncludeUnresolved(e.target.checked)} />
          Show unresolved identifiers
        </label>
      </div>

      {error && <div className="text-bad text-sm mb-4">{error}</div>}
      {loading ? (
        <div className="text-muted text-sm">Loading…</div>
      ) : entities.length === 0 ? (
        <EmptyState title="No entities found" subtitle="Try clearing filters, or ingest and process a dataset first." />
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#0f1420] text-muted text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Entity</th>
                <th className="text-left px-4 py-3 font-semibold">Crime Type</th>
                <th className="text-left px-4 py-3 font-semibold">Case</th>
                <th className="text-left px-4 py-3 font-semibold">Connections</th>
                <th className="text-left px-4 py-3 font-semibold">Reliability</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {entities.map((e) => (
                <tr key={e.id} className="border-t border-border hover:bg-[#131926] transition-colors">
                  <td className="px-4 py-3">
                    <div className="text-gray-100 font-medium flex items-center gap-2">
                      {e.name}
                      {e.is_unresolved && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider bg-warn/10 text-warn border border-warn/30">
                          Unresolved
                        </span>
                      )}
                    </div>
                    <div className="text-muted text-xs mono">{e.id}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{e.crime_type || "—"}</td>
                  <td className="px-4 py-3 mono text-gray-300">{e.case_id || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`mono font-semibold ${e.connection_count === 0 ? "text-muted" : "text-gray-200"}`}>{e.connection_count}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`mono text-xs font-semibold ${e.reliability >= 70 ? "text-good" : e.reliability >= 40 ? "text-warn" : "text-muted"}`}>
                      {e.reliability}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/entities/${e.id}`} className="text-accent text-xs font-medium hover:underline">
                      View Profile →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
