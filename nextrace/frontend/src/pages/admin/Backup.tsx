import { useCallback, useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader";
import EmptyState from "../../components/EmptyState";
import { api, ApiError } from "../../api/client";

export default function Backup() {
  const [backups, setBackups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<any>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.listBackups().then(setBackups).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createBackup() {
    setBusy(true);
    setNotice(null);
    try {
      const r = await api.createBackup();
      setNotice({ kind: "ok", text: r.message });
      load();
    } catch (e: any) {
      setNotice({ kind: "err", text: e instanceof ApiError ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function download(id: number) {
    setBusy(true);
    setNotice(null);
    try {
      const { blob, filename } = await api.downloadBackup(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setNotice({ kind: "ok", text: `Backup ${filename} downloaded.` });
    } catch (e: any) {
      setNotice({ kind: "err", text: e instanceof ApiError ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Backup & Restore" subtitle="Create encrypted-quality point-in-time backups and download them for off-site storage." />

      {notice && (
        <div className={`mb-5 px-4 py-3 rounded-lg border text-sm ${notice.kind === "ok" ? "bg-good/10 border-good/40 text-good" : "bg-bad/10 border-bad/40 text-bad"}`}>
          {notice.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <div className="bg-card border border-border rounded-lg p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold text-gray-100 mb-1">Create a Backup</h3>
          <p className="text-xs text-muted mb-4">
            Snapshots every case dataset, entity relationships, resolution candidates, access grants,
            case messages and the evidence SHA-256 registry into a single gzipped JSON manifest. The
            integrity of each file is pinned with its own SHA-256 and the action is audit-logged.
            The immutable ledger is exempt by design (it is itself the append-only record).
          </p>
          <div className="bg-[#0f1420] border border-border rounded p-3 text-xs text-muted leading-relaxed">
            <span className="text-gray-300 font-medium">What is included:</span> persons, CDR, financial records,
            CCTV sightings, investigation reports, cases, relationships, resolution candidates, case access,
            case messages, access grants/requests, audit logs, evidence hashes, case status history, biometric metadata.
            <div className="mt-1"><span className="text-gray-300 font-medium">Ruled out:</span> the immutable ledger table/mirror
            (kept as its own append-only history), demo-tamper snapshots and security events (operational history).</div>
          </div>
          <button
            onClick={createBackup}
            disabled={busy}
            className="mt-4 px-4 py-2 rounded-md bg-accent text-bg text-sm font-semibold hover:bg-accent2 disabled:opacity-40"
          >
            {busy ? "Working…" : "Create Backup Now"}
          </button>
        </div>

        <div className="bg-card border border-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-warn mb-1">Restore — Future Capability</h3>
          <p className="text-xs text-muted leading-relaxed">
            This prototype implements{" "}
            <span className="text-gray-300">backup create, history, and secure download</span>.{" "}
            Restoring a backup back into the database is deliberately{" "}
            <span className="text-gray-200">deferred</span>: it is a destructive, high-risk operation that
            needs validation by an Admin Investigator before implementation. The manifest structure is already
            versioned (<span className="mono">schema_version 1.0</span>) so a restore engine can be added later
            without breaking existing backups.
          </p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden overflow-x-auto">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-gray-100">Backup History</h3>
        </div>
        {loading ? (
          <div className="p-6 text-muted text-sm">Loading…</div>
        ) : backups.length === 0 ? (
          <EmptyState title="No backups yet" subtitle="Create your first backup above." />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#0f1420] text-muted text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2">ID</th>
                <th className="text-left px-4 py-2">Filename</th>
                <th className="text-left px-4 py-2">Created</th>
                <th className="text-left px-4 py-2">By</th>
                <th className="text-left px-4 py-2">Size</th>
                <th className="text-left px-4 py-2">SHA-256</th>
                <th className="text-left px-4 py-2">Records</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.id} className="border-t border-border">
                  <td className="px-4 py-2 mono text-muted text-xs">{b.id}</td>
                  <td className="px-4 py-2 mono text-gray-200">{b.filename}</td>
                  <td className="px-4 py-2 mono text-gray-400 text-xs">{b.created_at}</td>
                  <td className="px-4 py-2 mono text-gray-400 text-xs">{b.created_by}</td>
                  <td className="px-4 py-2 mono text-gray-400 text-xs">{(b.size_bytes / 1024).toFixed(1)} KB</td>
                  <td className="px-4 py-2 mono text-muted text-xs" title={b.sha256}>{(b.sha256 || "").slice(0, 16)}…</td>
                  <td className="px-4 py-2 text-muted text-xs">{b.records ? Object.keys(b.records).length : "—"} table(s)</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => download(b.id)} disabled={busy} className="px-2.5 py-1 rounded border border-border text-xs text-accent hover:bg-[#131926] disabled:opacity-40">Download</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}