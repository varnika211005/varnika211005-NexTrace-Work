import { useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader";
import { StatusBadge } from "../../components/Badge";
import { api } from "../../api/client";

export default function Users() {
  const [users, setUsers] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ analyst_id: "", name: "", password: "", role: "investigator" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api.listUsers().then(setUsers);
  }

  useEffect(() => { load(); }, []);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createUser(form);
      setForm({ analyst_id: "", name: "", password: "", role: "investigator" });
      setShowForm(false);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(analystId: string) {
    await api.toggleUser(analystId);
    load();
  }

  return (
    <div>
      <PageHeader title="User Management" subtitle="Create and manage Investigator and Admin Investigator accounts.">
        <button onClick={() => setShowForm(!showForm)} className="px-4 py-2 rounded-md bg-accent text-bg text-sm font-semibold hover:bg-accent2">
          {showForm ? "Cancel" : "Create User"}
        </button>
      </PageHeader>

      {showForm && (
        <form onSubmit={createUser} className="bg-card border border-border rounded-lg p-5 mb-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted">Analyst ID</label>
            <input required value={form.analyst_id} onChange={(e) => setForm({ ...form, analyst_id: e.target.value })} className="w-full mt-1 bg-[#0f1420] border border-border rounded px-3 py-2 text-sm text-gray-200 mono" />
          </div>
          <div>
            <label className="text-xs text-muted">Name</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full mt-1 bg-[#0f1420] border border-border rounded px-3 py-2 text-sm text-gray-200" />
          </div>
          <div>
            <label className="text-xs text-muted">Password</label>
            <input required type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full mt-1 bg-[#0f1420] border border-border rounded px-3 py-2 text-sm text-gray-200" />
          </div>
          <div>
            <label className="text-xs text-muted">Role</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full mt-1 bg-[#0f1420] border border-border rounded px-3 py-2 text-sm text-gray-200">
              <option value="investigator">Investigator</option>
              <option value="admin_investigator">Admin Investigator</option>
            </select>
          </div>
          {error && <div className="md:col-span-2 text-bad text-sm">{error}</div>}
          <button disabled={busy} type="submit" className="md:col-span-2 px-4 py-2 rounded-md bg-accent text-bg text-sm font-semibold hover:bg-accent2 disabled:opacity-50">
            {busy ? "Creating…" : "Create User"}
          </button>
        </form>
      )}

      <div className="bg-card border border-border rounded-lg overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#0f1420] text-muted text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">Analyst ID</th>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Role</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Assigned Cases</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="px-4 py-3 mono text-gray-200">{u.analyst_id}</td>
                <td className="px-4 py-3 text-gray-300">{u.name}</td>
                <td className="px-4 py-3 text-muted text-xs">{u.role === "admin_investigator" ? "Admin Investigator" : "Investigator"}</td>
                <td className="px-4 py-3"><StatusBadge status={u.status} /></td>
                <td className="px-4 py-3 mono text-gray-300">{u.assigned_cases}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => toggle(u.analyst_id)} className="text-accent text-xs font-medium hover:underline">
                    {u.status === "Active" ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
