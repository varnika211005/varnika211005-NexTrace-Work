import { Fragment, useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader";
import { StatusBadge } from "../../components/Badge";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api/client";

interface EditState {
  name: string;
  role: string;
  new_password: string;
}

export default function Users() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ analyst_id: "", name: "", password: "", role: "investigator" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState>({ name: "", role: "investigator", new_password: "" });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editSuccess, setEditSuccess] = useState<string | null>(null);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
    setError(null);
    try {
      await api.toggleUser(analystId);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  function startEdit(u: any) {
    setEditingId(u.analyst_id);
    setEdit({ name: u.name, role: u.role, new_password: "" });
    setError(null);
    setEditSuccess(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditSuccess(null);
  }

  async function saveEdit(u: any) {
    setError(null);
    setEditSuccess(null);

    const updates: { name?: string; role?: string; new_password?: string } = {};
    if (edit.name.trim() && edit.name.trim() !== u.name) updates.name = edit.name.trim();
    if (edit.role !== u.role) updates.role = edit.role;
    if (edit.new_password.trim()) {
      if (edit.new_password.trim().length < 6) {
        setError("New password must be at least 6 characters.");
        return;
      }
      updates.new_password = edit.new_password.trim();
    }

    if (Object.keys(updates).length === 0) {
      setEditingId(null);
      return;
    }

    setSavingEdit(true);
    try {
      await api.updateUser(u.analyst_id, updates);
      setEditingId(null);
      setEditSuccess(`${u.analyst_id} updated.`);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(analystId: string) {
    setDeletingId(analystId);
    setError(null);
    try {
      await api.deleteUser(analystId);
      setConfirmDeleteId(null);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeletingId(null);
    }
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

      {error && !showForm && <div className="mb-4 bg-bad/10 border border-bad/30 text-bad text-sm rounded-md px-4 py-3">{error}</div>}
      {editSuccess && <div className="mb-4 bg-good/10 border border-good/30 text-good text-sm rounded-md px-4 py-3">{editSuccess}</div>}

      <p className="text-xs text-muted mb-3">
        An Admin Investigator can always sign in, even while marked Inactive, so the system can never lock
        out its own administrators. An Investigator set to Inactive is signed out immediately and cannot
        sign back in until reactivated. You cannot change your own role, deactivate, or delete your own
        account — ask another Admin Investigator to do that if needed.
      </p>

      <div className="bg-card border border-border rounded-lg overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#0f1420] text-muted text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">Analyst ID</th>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Role</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Assigned Cases</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.analyst_id === currentUser?.analyst_id;
              const isEditing = editingId === u.analyst_id;
              return (
                <Fragment key={u.analyst_id}>
                  <tr className="border-t border-border">
                    <td className="px-4 py-3 mono text-gray-200">{u.analyst_id}{isSelf && <span className="text-muted text-[10px] ml-1.5">(you)</span>}</td>
                    <td className="px-4 py-3 text-gray-300">{u.name}</td>
                    <td className="px-4 py-3 text-muted text-xs">{u.role === "admin_investigator" ? "Admin Investigator" : "Investigator"}</td>
                    <td className="px-4 py-3"><StatusBadge status={u.status} /></td>
                    <td className="px-4 py-3 mono text-gray-300">{u.assigned_cases}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {confirmDeleteId === u.analyst_id ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-bad text-xs">Delete permanently?</span>
                          <button disabled={deletingId === u.analyst_id} onClick={() => handleDelete(u.analyst_id)} className="text-bad text-xs font-semibold hover:underline disabled:opacity-50">
                            {deletingId === u.analyst_id ? "Deleting…" : "Yes"}
                          </button>
                          <button onClick={() => setConfirmDeleteId(null)} className="text-muted text-xs hover:underline">Cancel</button>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-3">
                          <button onClick={() => (isEditing ? cancelEdit() : startEdit(u))} className="text-accent text-xs font-medium hover:underline">
                            {isEditing ? "Close" : "Edit"}
                          </button>
                          {!isSelf && (
                            <button onClick={() => toggle(u.analyst_id)} className="text-accent text-xs font-medium hover:underline">
                              {u.status === "Active" ? "Deactivate" : "Activate"}
                            </button>
                          )}
                          {!isSelf && (
                            <button onClick={() => setConfirmDeleteId(u.analyst_id)} className="text-bad text-xs font-medium hover:underline">
                              Delete
                            </button>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>

                  {isEditing && (
                    <tr className="border-t border-border bg-[#0f1420]">
                      <td colSpan={6} className="px-4 py-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl">
                          <div>
                            <label className="text-[11px] text-muted uppercase tracking-wider">Name</label>
                            <input
                              value={edit.name}
                              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                              className="w-full mt-1 bg-card border border-border rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-accent"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] text-muted uppercase tracking-wider">Role</label>
                            <select
                              value={edit.role}
                              disabled={isSelf}
                              onChange={(e) => setEdit({ ...edit, role: e.target.value })}
                              className="w-full mt-1 bg-card border border-border rounded px-3 py-2 text-sm text-gray-100 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-accent"
                            >
                              <option value="investigator">Investigator</option>
                              <option value="admin_investigator">Admin Investigator</option>
                            </select>
                            {isSelf && <div className="text-[10px] text-muted mt-1">Can't change your own role.</div>}
                          </div>
                          <div>
                            <label className="text-[11px] text-muted uppercase tracking-wider">Reset Password</label>
                            <input
                              type="password"
                              placeholder="Leave blank to keep current"
                              value={edit.new_password}
                              onChange={(e) => setEdit({ ...edit, new_password: e.target.value })}
                              className="w-full mt-1 bg-card border border-border rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-accent"
                            />
                          </div>
                        </div>
                        <div className="flex gap-2 mt-4">
                          <button disabled={savingEdit} onClick={() => saveEdit(u)} className="px-4 py-1.5 rounded-md bg-accent text-bg text-xs font-semibold hover:bg-accent2 disabled:opacity-50">
                            {savingEdit ? "Saving…" : "Save Changes"}
                          </button>
                          <button onClick={cancelEdit} className="px-4 py-1.5 rounded-md border border-border text-gray-300 text-xs font-semibold hover:bg-[#1a2130]">
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}