import { useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader";
import EmptyState from "../../components/EmptyState";
import { api } from "../../api/client";

export default function Audit() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actor, setActor] = useState("");

  function load() {
    setLoading(true);
    api.auditLog(actor ? { actor } : {}).then(setLogs).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []); // eslint-disable-line

  return (
    <div>
      <PageHeader title="Audit & Provenance" subtitle="Every system action, logged with user, role, action, resource, and result." />

      <div className="flex gap-3 mb-5">
        <select value={actor} onChange={(e) => setActor(e.target.value)} className="bg-card border border-border rounded-md px-3 py-2 text-sm text-gray-200">
          <option value="">All users</option>
          <option value="ADMIN01">ADMIN01</option>
          <option value="INV204">INV204</option>
        </select>
        <button onClick={load} className="px-4 py-2 rounded-md bg-accent text-bg text-sm font-semibold hover:bg-accent2">Filter</button>
      </div>

      {loading ? (
        <div className="text-muted text-sm">Loading…</div>
      ) : logs.length === 0 ? (
        <EmptyState title="No audit records found" />
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#0f1420] text-muted text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2">Timestamp</th>
                <th className="text-left px-4 py-2">User</th>
                <th className="text-left px-4 py-2">Role</th>
                <th className="text-left px-4 py-2">Action</th>
                <th className="text-left px-4 py-2">Resource</th>
                <th className="text-left px-4 py-2">Case</th>
                <th className="text-left px-4 py-2">Result</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="px-4 py-2 mono text-gray-400 text-xs">{l.timestamp}</td>
                  <td className="px-4 py-2 mono text-gray-200">{l.user}</td>
                  <td className="px-4 py-2 text-muted text-xs">{l.role === "admin_investigator" ? "Admin" : "Investigator"}</td>
                  <td className="px-4 py-2 text-gray-300">{l.action}</td>
                  <td className="px-4 py-2 mono text-muted text-xs">{l.resource || "—"}</td>
                  <td className="px-4 py-2 mono text-muted text-xs">{l.case_id || "—"}</td>
                  <td className="px-4 py-2"><span className="text-good text-xs">{l.result}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
