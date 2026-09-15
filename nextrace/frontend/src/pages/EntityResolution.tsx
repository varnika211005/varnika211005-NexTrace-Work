import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import { StatusBadge } from "../components/Badge";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";

export default function EntityResolution() {
  const { isAdmin } = useAuth();
  const [candidates, setCandidates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  function load() {
    setLoading(true);
    api.listResolutionCandidates().then(setCandidates).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function act(id: number, action: "confirm" | "reject") {
    setBusyId(id);
    try {
      if (action === "confirm") await api.confirmMatch(id);
      else await api.rejectMatch(id);
      load();
    } finally {
      setBusyId(null);
    }
  }

  const pending = candidates.filter((c) => c.status === "Pending");
  const reviewed = candidates.filter((c) => c.status !== "Pending");

  return (
    <div>
      <PageHeader title="Entity Resolution" subtitle="Possible duplicate or alias matches surfaced by name-similarity analysis. AI recommends — a human confirms or rejects." />

      {!isAdmin && (
        <div className="mb-5 bg-warn/10 border border-warn/30 text-warn text-xs rounded-md px-4 py-3">
          You are viewing in read-only mode. Confirming or rejecting matches requires Admin Investigator permissions.
        </div>
      )}

      {loading ? (
        <div className="text-muted text-sm">Loading…</div>
      ) : candidates.length === 0 ? (
        <EmptyState title="No candidates found" subtitle="Run the processing pipeline to generate entity-resolution candidates." />
      ) : (
        <>
          <h3 className="text-sm font-semibold text-gray-100 mb-3">Pending Review ({pending.length})</h3>
          <div className="space-y-3 mb-8">
            {pending.map((c) => (
              <div key={c.id} className="bg-card border border-border rounded-lg p-4">
                <div className="flex justify-between items-start mb-3 flex-wrap gap-2">
                  <div>
                    <span className="text-gray-100 font-medium">{c.person_a.name}</span>
                    <span className="text-muted mx-2">vs</span>
                    <span className="text-gray-100 font-medium">{c.person_b.name}</span>
                  </div>
                  <span className="mono text-sm text-accent font-semibold">{c.similarity}% match</span>
                </div>
                <ul className="space-y-1 mb-3">
                  {c.reasons.map((r: string, i: number) => (
                    <li key={i} className="text-xs text-muted flex gap-2"><span className="text-accent">•</span>{r}</li>
                  ))}
                </ul>
                {isAdmin && (
                  <div className="flex gap-2">
                    <button disabled={busyId === c.id} onClick={() => act(c.id, "confirm")} className="px-3 py-1.5 rounded-md bg-good/10 text-good border border-good/30 text-xs font-semibold hover:bg-good/20 disabled:opacity-50">
                      Confirm Match
                    </button>
                    <button disabled={busyId === c.id} onClick={() => act(c.id, "reject")} className="px-3 py-1.5 rounded-md bg-bad/10 text-bad border border-bad/30 text-xs font-semibold hover:bg-bad/20 disabled:opacity-50">
                      Reject Match
                    </button>
                  </div>
                )}
              </div>
            ))}
            {pending.length === 0 && <div className="text-muted text-sm">No pending candidates — all reviewed.</div>}
          </div>

          {reviewed.length > 0 && (
            <>
              <h3 className="text-sm font-semibold text-gray-100 mb-3">Reviewed ({reviewed.length})</h3>
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-[#0f1420] text-muted text-xs uppercase tracking-wider">
                    <tr><th className="text-left px-4 py-2">Pair</th><th className="text-left px-4 py-2">Similarity</th><th className="text-left px-4 py-2">Status</th><th className="text-left px-4 py-2">Reviewed By</th></tr>
                  </thead>
                  <tbody>
                    {reviewed.map((c) => (
                      <tr key={c.id} className="border-t border-border">
                        <td className="px-4 py-2 text-gray-300">{c.person_a.name} vs {c.person_b.name}</td>
                        <td className="px-4 py-2 mono text-gray-300">{c.similarity}%</td>
                        <td className="px-4 py-2"><StatusBadge status={c.status} /></td>
                        <td className="px-4 py-2 text-muted text-xs">{c.reviewed_by}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
