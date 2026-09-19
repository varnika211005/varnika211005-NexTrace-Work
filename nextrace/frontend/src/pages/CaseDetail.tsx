import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import { SeverityBadge } from "../components/Badge";
import RequestAccessButton from "../components/RequestAccessButton";
import { useAuth } from "../context/AuthContext";
import { api, ApiError } from "../api/client";

export default function CaseDetail() {
  const { caseId } = useParams<{ caseId: string }>();
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  const [messages, setMessages] = useState<any[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusDraft, setStatusDraft] = useState("");
  const [statusComment, setStatusComment] = useState("");

  useEffect(() => {
    if (!caseId) return;
    setData(null);
    setError(null);
    setAccessDenied(false);
    api.getCase(caseId).then(setData).catch((e: any) => {
      if (e instanceof ApiError && e.status === 403) setAccessDenied(true);
      else setError(e.message);
    });
    loadMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  function loadMessages() {
    if (!caseId) return;
    setMessagesLoading(true);
    api.listCaseMessages(caseId).then(setMessages).catch(() => {}).finally(() => setMessagesLoading(false));
  }

  async function sendMessage() {
    if (!caseId || !newMessage.trim()) return;
    setSending(true);
    try {
      await api.postCaseMessage(caseId, newMessage.trim());
      setNewMessage("");
      loadMessages();
    } finally {
      setSending(false);
    }
  }

  async function changeStatus() {
    if (!caseId || !statusDraft || statusDraft === data?.status) return;
    setStatusBusy(true);
    setStatusError(null);
    try {
      await api.changeCaseStatus(caseId, statusDraft, statusComment);
      setStatusComment("");
      const updated = await api.getCase(caseId);
      setData(updated);
    } catch (e: any) {
      setStatusError(e.message);
    } finally {
      setStatusBusy(false);
    }
  }

  if (accessDenied) {
    return (
      <div>
        <PageHeader title="Access Restricted" subtitle={`Case ${caseId}`} />
        <div className="bg-card border border-border rounded-lg p-8 max-w-lg">
          <p className="text-gray-300 text-sm mb-4">
            You aren't assigned to this case, so its details aren't visible to you. If this case
            is relevant to your investigation, you can request access from an Admin Investigator.
          </p>
          {caseId && <RequestAccessButton requestType="case" targetId={caseId} targetLabel={`case ${caseId}`} />}
        </div>
      </div>
    );
  }

  if (error) return <div className="text-bad text-sm">{error}</div>;
  if (!data) return <div className="text-muted text-sm">Loading…</div>;

  return (
    <div>
      <PageHeader title={data.title} subtitle={`Case ${data.case_id} · ${data.status}`}>
        <Link to={`/network`} className="px-3 py-1.5 rounded-md bg-accent text-bg text-sm font-semibold hover:bg-accent2">Open Network →</Link>
        <Link to={`/reports?case_id=${data.case_id}`} className="px-3 py-1.5 rounded-md bg-[#1a2130] border border-border text-gray-200 text-sm font-semibold hover:bg-[#212a3d]">Generate Report</Link>
      </PageHeader>

      {/* Case status workflow */}
      <div className="bg-card border border-border rounded-lg p-5 mb-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-[11px] uppercase text-muted mb-1">Current Status</div>
            <span className={`px-2.5 py-1 rounded-md border text-sm font-medium ${data.status === "Solved" ? "border-good/50 text-good" : data.status === "Unsolved or Closed" ? "border-border text-muted" : "border-accent/40 text-accent"}`}>
              {data.status}
            </span>
          </div>
          {data.can_change_status ? (
            <>
              <div className="flex-1 min-w-[180px]">
                <div className="text-[11px] uppercase text-muted mb-1">Move to</div>
                <select
                  value={statusDraft}
                  onChange={(e) => setStatusDraft(e.target.value)}
                  className="w-full bg-[#0f1420] border border-border rounded-md px-2 py-1.5 text-sm text-gray-200"
                >
                  <option value="">Select status…</option>
                  {data.allowed_statuses.map((s: string) => (
                    <option key={s} value={s} disabled={s === data.status}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1 min-w-[200px]">
                <div className="text-[11px] uppercase text-muted mb-1">Comment (audited)</div>
                <input
                  value={statusComment}
                  onChange={(e) => setStatusComment(e.target.value)}
                  placeholder={`Why is this case moving to “${statusDraft || "…"}”?`}
                  className="w-full bg-[#0f1420] border border-border rounded-md px-3 py-2 text-sm text-gray-100 placeholder-muted focus:outline-none focus:border-accent"
                />
              </div>
              <button
                onClick={changeStatus}
                disabled={statusBusy || !statusDraft || statusDraft === data.status}
                className="px-4 py-2 rounded-md bg-accent text-bg text-sm font-semibold hover:bg-accent2 disabled:opacity-40"
              >
                {statusBusy ? "Updating…" : "Change Status"}
              </button>
            </>
          ) : (
            <div className="text-xs text-muted">Only Admin Investigators or investigators with Read/Write access can change case status.</div>
          )}
        </div>
        {statusError && <div className="mt-2 text-bad text-xs">{statusError}</div>}
        {data.status_history.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <div className="text-[11px] uppercase text-muted font-semibold mb-2">Status History</div>
            <div className="space-y-1.5">
              {data.status_history.map((h: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="mono text-gray-400">{h.changed_at}</span>
                  <span className="text-muted">{h.previous_status}</span>
                  <span className="text-accent">→</span>
                  <span className="text-gray-200">{h.new_status}</span>
                  <span className="text-muted">by {h.changed_by}</span>
                  {h.comment && <span className="text-muted italic">“{h.comment}”</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <div className="bg-card border border-border rounded-lg p-4"><div className="text-[11px] uppercase text-muted">Subjects</div><div className="text-2xl font-bold mono text-gray-100">{data.subjects.length}</div></div>
        <div className="bg-card border border-border rounded-lg p-4"><div className="text-[11px] uppercase text-muted">Relationships</div><div className="text-2xl font-bold mono text-accent">{data.relationship_count}</div></div>
        <div className="bg-card border border-border rounded-lg p-4"><div className="text-[11px] uppercase text-muted">Evidence Items</div><div className="text-2xl font-bold mono text-gray-100">{data.evidence_count}</div></div>
        <div className="bg-card border border-border rounded-lg p-4"><div className="text-[11px] uppercase text-muted">Reports Filed</div><div className="text-2xl font-bold mono text-gray-100">{data.reports.length}</div></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-card border border-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-gray-100 mb-3">Subjects</h3>
          <div className="space-y-2">
            {data.subjects.map((s: any) => (
              <Link key={s.id} to={`/entities/${s.id}`} className="flex justify-between items-center border border-border rounded p-2.5 hover:border-accent/50">
                <span className="text-gray-200 text-sm">{s.name}</span>
                <span className="text-muted text-xs">{s.crime_type}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-gray-100 mb-3">Intelligence Indicators</h3>
          {data.intelligence_indicators.length === 0 ? (
            <div className="text-muted text-sm">No pattern findings for this case yet.</div>
          ) : (
            <div className="space-y-2">
              {data.intelligence_indicators.map((ind: any, i: number) => (
                <div key={i} className="border border-border rounded p-2.5 bg-[#0f1420]">
                  <div className="flex items-center gap-2 mb-1"><SeverityBadge severity={ind.severity} /><span className="text-gray-200 text-sm font-medium">{ind.title}</span></div>
                  <p className="text-xs text-muted">{ind.explanation}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Case Discussion - shared thread for everyone assigned to this case */}
        <div className="bg-card border border-border rounded-lg p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold text-gray-100 mb-1">Case Discussion</h3>
          <p className="text-xs text-muted mb-3">
            Visible to everyone assigned to case {data.case_id} — share leads and progress here.
          </p>

          <div className="bg-[#0f1420] border border-border rounded-md p-3 max-h-80 overflow-y-auto mb-3">
            {messagesLoading ? (
              <div className="text-muted text-sm">Loading messages…</div>
            ) : messages.length === 0 ? (
              <div className="text-muted text-sm text-center py-4">No messages yet — start the discussion below.</div>
            ) : (
              <div className="space-y-3">
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.is_own ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[75%] rounded-lg px-3 py-2 ${m.is_own ? "bg-accent/15 border border-accent/30" : "bg-card border border-border"}`}>
                      <div className="flex items-baseline gap-2 mb-0.5">
                        <span className="text-xs font-semibold text-gray-200">{m.is_own ? "You" : m.sender_name}</span>
                        <span className="text-[10px] text-muted mono">{new Date(m.created_at).toLocaleString()}</span>
                      </div>
                      <div className="text-sm text-gray-300 whitespace-pre-wrap">{m.message}</div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <input
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="Share a lead or update…"
              className="flex-1 bg-[#0f1420] border border-border rounded-md px-3 py-2 text-sm text-gray-100 placeholder-muted focus:outline-none focus:border-accent"
            />
            <button
              onClick={sendMessage}
              disabled={sending || !newMessage.trim()}
              className="px-4 py-2 rounded-md bg-accent text-bg text-sm font-semibold hover:bg-accent2 disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold text-gray-100 mb-3">Investigation Reports</h3>
          {data.reports.length === 0 ? (
            <div className="text-muted text-sm">No reports filed for this case.</div>
          ) : (
            <div className="space-y-3">
              {data.reports.map((r: any) => (
                <div key={r.id} className="border border-border rounded p-3">
                  <div className="flex justify-between text-xs text-muted mb-1"><span className="mono">{r.id}</span><span>{r.date_filed}</span></div>
                  <div className="text-gray-100 font-medium text-sm">{r.title}</div>
                  <div className="text-gray-400 text-xs mt-1">{r.narrative_text}</div>
                  <div className="text-[10px] text-muted mt-1">Filed by {r.officer}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-lg p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold text-gray-100 mb-3">Assigned Investigators</h3>
          {data.assigned_investigators.length === 0 ? (
            <div className="text-muted text-sm">No investigators formally assigned to this case yet (see Admin → Access Control).</div>
          ) : (
            <div className="flex gap-2 flex-wrap">
              {data.assigned_investigators.map((a: any, i: number) => (
                <span key={i} className={`px-2.5 py-1 rounded-md border text-xs ${a.analyst_id === user?.analyst_id ? "border-accent/40 text-accent" : "border-border text-gray-300"}`}>
                  {a.analyst_id} · {a.access_level}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}