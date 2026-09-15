import { useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader";
import { api } from "../../api/client";

export default function AccessControl() {
  const [access, setAccess] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [cases, setCases] = useState<any[]>([]);
  const [form, setForm] = useState({ case_id: "", analyst_id: "", access_level: "Read/Write" });
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.listAccess().then(setAccess);
    api.listUsers().then(setUsers);
    api.listCases().then(setCases);
  }

  useEffect(() => { load(); }, []);

  async function assign(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.assignAccess(form);
      setForm({ case_id: "", analyst_id: "", access_level: "Read/Write" });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function remove(id: number) {
    await api.removeAccess(id);
    load();
  }

  return (
    <div>
      <PageHeader title="Access Control" subtitle="Assign investigators to cases. Investigators only see cases they're authorized for; this page governs that access." />

      <form onSubmit={assign} className="bg-card border border-border rounded-lg p-5 mb-5 grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
        <div>
          <label className="text-xs text-muted">Case</label>
          <select required value={form.case_id} onChange={(e) => setForm({ ...form, case_id: e.target.value })} className="w-full mt-1 bg-[#0f1420] border border-border rounded px-3 py-2 text-sm text-gray-200">
            <option value="">Select case…</option>
            {cases.map((c) => <option key={c.case_id} value={c.case_id}>{c.case_id}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted">Investigator</label>
          <select required value={form.analyst_id} onChange={(e) => setForm({ ...form, analyst_id: e.target.value })} className="w-full mt-1 bg-[#0f1420] border border-border rounded px-3 py-2 text-sm text-gray-200">
            <option value="">Select user…</option>
            {users.map((u) => <option key={u.analyst_id} value={u.analyst_id}>{u.analyst_id} — {u.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted">Access Level</label>
          <select value={form.access_level} onChange={(e) => setForm({ ...form, access_level: e.target.value })} className="w-full mt-1 bg-[#0f1420] border border-border rounded px-3 py-2 text-sm text-gray-200">
            <option value="Read/Write">Read/Write</option>
            <option value="Read Only">Read Only</option>
          </select>
        </div>
        <button type="submit" className="px-4 py-2 rounded-md bg-accent text-bg text-sm font-semibold hover:bg-accent2 h-fit">Assign Access</button>
      </form>
      {error && <div className="mb-4 text-bad text-sm">{error}</div>}

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#0f1420] text-muted text-xs uppercase tracking-wider">
            <tr><th className="text-left px-4 py-3">Case</th><th className="text-left px-4 py-3">Investigator</th><th className="text-left px-4 py-3">Access Level</th><th></th></tr>
          </thead>
          <tbody>
            {access.map((a) => (
              <tr key={a.id} className="border-t border-border">
                <td className="px-4 py-3 mono text-accent">{a.case_id}</td>
                <td className="px-4 py-3 text-gray-200">{a.analyst_id}</td>
                <td className="px-4 py-3 text-muted text-xs">{a.access_level}</td>
                <td className="px-4 py-3 text-right"><button onClick={() => remove(a.id)} className="text-bad text-xs hover:underline">Remove</button></td>
              </tr>
            ))}
            {access.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-muted text-sm">No access assignments yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
