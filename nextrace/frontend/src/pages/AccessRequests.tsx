import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import { StatusBadge } from "../components/Badge";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";

export default function AccessRequests() {
  const { isAdmin } = useAuth();
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ request_type: "case", target_id: "", reason: "" });
  const [submitting, setSubmitting] = useState(false);

  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const [adminNote, setAdminNote] = useState("");
  const [reviewAction, setReviewAction] = useState<"approve" | "deny" | null>(null);
  const [reviewing, setReviewing] = useState(false);

  function load() {
    setLoading(true);
    api.listAccessRequests().then(setRequests).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.createAccessRequest(form as any);
      setForm({ request_type: "case", target_id: "", reason: "" });
      setShowForm(false);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function startReview(id: number, action: "approve" | "deny") {
    setReviewingId(id);
    setReviewAction(action);
    setAdminNote("");
  }

  async function confirmReview() {
    if (!reviewingId || !reviewAction) return;
    setReviewing(true);
    setError(null);
    try {
      if (reviewAction === "approve") await api.approveAccessRequest(reviewingId, adminNote || undefined);
      else await api.denyAccessRequest(reviewingId, adminNote || undefined);
      setReviewingId(null);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setReviewing(false);
    }
  }

  const pending = requests.filter((r) => r.status === "Pending");
  const reviewed = requests.filter((r) => r.status !== "Pending");

  return (
    <div>
      <PageHeader
        title="Access Requests"
        subtitle={isAdmin
          ? "Review Investigator requests for data outside their case assignments."
          : "Request access to a case or subject outside your current assignment."}
      >
        {!isAdmin && (
          <button onClick={() => setShowForm(!showForm)} className="px-4 py-2 rounded-md bg-accent text-bg text-sm font-semibold hover:bg-accent2">
            {showForm ? "Cancel" : "New Request"}
          </button>
        )}
      </PageHeader>

      {error && <div className="mb-4 bg-bad/10 border border-bad/30 text-bad text-sm rounded-md px-4 py-3">{error}</div>}

      {showForm && !isAdmin && (
        <form onSubmit={submitRequest} className="bg-card border border-border rounded-lg p-5 mb-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted">Requesting access to</label>
              <select
                value={form.request_type}
                onChange={(e) => setForm({ ...form, request_type: e.target.value })}
                className="w-full mt-1 bg-[#0f1420] border border-border rounded px-3 py-2 text-sm text-gray-200"
              >
                <option value="case">An entire case</option>
                <option value="person">A specific subject</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted">{form.request_type === "case" ? "Case ID (e.g. NX-0655)" : "Subject ID (e.g. C003)"}</label>
              <input
                required
                value={form.target_id}
                onChange={(e) => setForm({ ...form, target_id: e.target.value })}
                placeholder={form.request_type === "case" ? "NX-0655" : "C003"}
                className="w-full mt-1 bg-[#0f1420] border border-border rounded px-3 py-2 text-sm text-gray-200 mono"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted">Reason</label>
            <textarea
              required
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              rows={3}
              placeholder="Why do you need this? (e.g. a lead in my case connects to this subject/case)"
              className="w-full mt-1 bg-[#0f1420] border border-border rounded px-3 py-2 text-sm text-gray-200 resize-none"
            />
          </div>
          <button disabled={submitting} type="submit" className="px-4 py-2 rounded-md bg-accent text-bg text-sm font-semibold hover:bg-accent2 disabled:opacity-50">
            {submitting ? "Submitting…" : "Submit Request"}
          </button>
        </form>
      )}

      {loading ? (
        <div className="text-muted text-sm">Loading…</div>
      ) : (
        <>
          <h3 className="text-sm font-semibold text-gray-100 mb-3">
            {isAdmin ? `Pending Review (${pending.length})` : `My Pending Requests (${pending.length})`}
          </h3>
          {pending.length === 0 ? (
            <div className="text-muted text-sm mb-8">No pending requests.</div>
          ) : (
            <div className="space-y-3 mb-8">
              {pending.map((r) => (
                <div key={r.id} className="bg-card border border-border rounded-lg p-4">
                  <div className="flex justify-between items-start mb-2 flex-wrap gap-2">
                    <div>
                      {isAdmin && <span className="text-gray-100 font-medium">{r.requester_name}</span>}
                      {isAdmin && <span className="text-muted text-xs mono ml-2">({r.requested_by})</span>}
                      <span className="text-muted text-xs ml-2">requesting {r.request_type === "case" ? "case" : "subject"} access to</span>
                      <span className="text-accent font-medium ml-1">{r.target_label || r.target_id}</span>
                    </div>
                    <span className="text-[10px] text-muted mono">{new Date(r.created_at).toLocaleString()}</span>
                  </div>
                  <p className="text-sm text-gray-300 mb-3">{r.reason}</p>

                  {isAdmin && (
                    reviewingId === r.id ? (
                      <div className="bg-[#0f1420] border border-border rounded-md p-3">
                        <textarea
                          value={adminNote}
                          onChange={(e) => setAdminNote(e.target.value)}
                          placeholder="Optional note…"
                          rows={2}
                          className="w-full bg-card border border-border rounded px-2 py-1.5 text-sm text-gray-200 resize-none mb-2"
                        />
                        <div className="flex gap-2">
                          <button disabled={reviewing} onClick={confirmReview} className={`px-3 py-1.5 rounded-md text-xs font-semibold disabled:opacity-50 ${reviewAction === "approve" ? "bg-good text-bg hover:bg-good/80" : "bg-bad text-white hover:bg-red-600"}`}>
                            {reviewing ? "Saving…" : `Confirm ${reviewAction === "approve" ? "Approval" : "Denial"}`}
                          </button>
                          <button onClick={() => setReviewingId(null)} className="px-3 py-1.5 rounded-md border border-border text-gray-300 text-xs font-semibold hover:bg-[#1a2130]">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button onClick={() => startReview(r.id, "approve")} className="px-3 py-1.5 rounded-md bg-good/10 border border-good/30 text-good text-xs font-semibold hover:bg-good/20">
                          Approve
                        </button>
                        <button onClick={() => startReview(r.id, "deny")} className="px-3 py-1.5 rounded-md bg-bad/10 border border-bad/30 text-bad text-xs font-semibold hover:bg-bad/20">
                          Deny
                        </button>
                        {r.request_type === "case" ? (
                          <Link to={`/cases/${r.target_id}`} className="px-3 py-1.5 rounded-md border border-border text-gray-300 text-xs font-semibold hover:bg-[#1a2130]">View Case</Link>
                        ) : (
                          <Link to={`/entities/${r.target_id}`} className="px-3 py-1.5 rounded-md border border-border text-gray-300 text-xs font-semibold hover:bg-[#1a2130]">View Subject</Link>
                        )}
                      </div>
                    )
                  )}
                </div>
              ))}
            </div>
          )}

          {reviewed.length > 0 && (
            <>
              <h3 className="text-sm font-semibold text-gray-100 mb-3">Reviewed</h3>
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-[#0f1420] text-muted text-xs uppercase tracking-wider">
                    <tr>
                      {isAdmin && <th className="text-left px-4 py-2">Requester</th>}
                      <th className="text-left px-4 py-2">Target</th>
                      <th className="text-left px-4 py-2">Status</th>
                      <th className="text-left px-4 py-2">Reviewed By</th>
                      <th className="text-left px-4 py-2">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewed.map((r) => (
                      <tr key={r.id} className="border-t border-border">
                        {isAdmin && <td className="px-4 py-2 text-gray-300">{r.requester_name}</td>}
                        <td className="px-4 py-2 text-gray-300">{r.target_label || r.target_id}</td>
                        <td className="px-4 py-2"><StatusBadge status={r.status} /></td>
                        <td className="px-4 py-2 text-muted text-xs">{r.reviewed_by || "—"}</td>
                        <td className="px-4 py-2 text-muted text-xs">{r.admin_note || "—"}</td>
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