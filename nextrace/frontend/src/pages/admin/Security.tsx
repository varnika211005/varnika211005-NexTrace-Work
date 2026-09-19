import { useCallback, useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader";
import EmptyState from "../../components/EmptyState";
import { api, ApiError } from "../../api/client";

const FIELDS: Record<string, { key: string; placeholder: string }[]> = {
  CDR: [{ key: "duration_seconds", placeholder: "e.g. 99999" }, { key: "caller_phone", placeholder: "e.g. +91 99999 00000" }],
  Financial: [{ key: "amount", placeholder: "e.g. 9999999" }, { key: "sender_account", placeholder: "e.g. 0XXXXX" }],
  CCTV: [{ key: "description", placeholder: "e.g. vehicle identified as..." }, { key: "location", placeholder: "e.g. Wrong Tower" }],
  Report: [{ key: "narrative_text", placeholder: "e.g. subjects mis-identified as..." }, { key: "title", placeholder: "e.g. Altered title" }],
  Person: [{ key: "address", placeholder: "e.g. 999, Wrong Nagar" }, { key: "aliases", placeholder: "e.g. Raghunath Kumar" }],
};

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={`w-2 h-2 rounded-full inline-block ${ok ? "bg-good" : "bg-bad"}`} />;
}

function Hash({ v }: { v: string }) {
  if (!v) return <span className="text-muted">—</span>;
  return (
    <code className="mono text-[11px] text-gray-300 break-all">{v.slice(0, 20)}<span className="text-muted">…{v.slice(-12)}</span></code>
  );
}

export default function Security() {
  const [status, setStatus] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [tampers, setTampers] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<any>(null);

  // Demo tamper form
  const [type, setType] = useState("CDR");
  const [recordId, setRecordId] = useState("");
  const [field, setField] = useState(FIELDS.CDR[0].key);
  const [value, setValue] = useState("");
  const [restoreKey, setRestoreKey] = useState<string | null>(null);

  const loadAll = useCallback(() => {
    api.security().then(setStatus).catch(() => {});
    api.securityEvents().then(setEvents).catch(() => {});
    api.tamperRecords().then(setTampers).catch(() => {});
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  function useType(t: string) {
    setType(t);
    setField(FIELDS[t][0].key);
  }

  async function run(fn: () => Promise<any>, okMessage: string) {
    setBusy(true);
    setNotice(null);
    try {
      const r = await fn();
      setNotice({ kind: "ok", text: r.message || okMessage, extra: r.warning });
    } catch (e: any) {
      setNotice({ kind: "err", text: e instanceof ApiError ? e.message : String(e) });
    } finally {
      setBusy(false);
      loadAll();
    }
  }

  if (!status) return <div className="text-muted text-sm">Loading…</div>;

  return (
    <div>
      <PageHeader title="Security & Evidence Integrity" subtitle="Live integrity posture, immutable ledger, tamper detection and demo tooling." />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: status.system_status === "Secure" ? "#34d399" : "#f87171" }} />
            <span className={`font-semibold text-sm uppercase tracking-wider ${status.system_status === "Secure" ? "text-good" : "text-bad"}`}>System Status: {status.system_status}</span>
          </div>
          <div className="space-y-1 text-sm text-gray-300">
            <div className="flex justify-between py-1.5 border-b border-border/50"><span className="text-muted">Authentication</span><span className="text-good text-xs">{status.authentication}</span></div>
            <div className="flex justify-between py-1.5 border-b border-border/50"><span className="text-muted">Role-based Access Control</span><span className="text-good">{status.role_based_access_control}</span></div>
            <div className="flex justify-between py-1.5 border-b border-border/50"><span className="text-muted">Audit Logging</span><span className="text-good">{status.audit_logging}</span></div>
            <div className="flex justify-between py-1.5 border-b border-border/50"><span className="text-muted">Data Provenance</span><span className="text-xs text-gray-300">{status.data_provenance}</span></div>
            <div className="flex justify-between py-1.5 border-b border-border/50"><span className="text-muted">Encryption at Rest</span><span className="text-xs text-muted">{status.encryption_at_rest}</span></div>
          </div>
          <div className="mt-5 pt-4 border-t border-border text-xs text-muted leading-relaxed">
            Local demonstration deployment with synthetic data. No secrets or credentials are displayed here by design.
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-center gap-2 mb-4">
            <StatusDot ok={!!status.chain_valid} />
            <span className="text-sm text-gray-200 font-semibold">{status.ledger_label}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-[#0f1420] border border-border rounded p-3"><div className="text-lg font-bold mono text-gray-100">{status.evidence_hashed}<span className="text-muted text-xs font-normal"> / {status.evidence_total}</span></div><div className="text-[10px] text-muted uppercase">Evidence SHA-256 sealed</div></div>
            <div className="bg-[#0f1420] border border-border rounded p-3"><div className="text-lg font-bold mono text-gray-100">{status.ledger_blocks}</div><div className="text-[10px] text-muted uppercase">Ledger blocks</div></div>
            <div className="bg-[#0f1420] border border-border rounded p-3"><div className={`text-lg font-bold mono ${status.chain_valid ? "text-good" : "text-bad"}`}>{status.chain_valid ? "Valid" : "Broken"}</div><div className="text-[10px] text-muted uppercase">Hash chain</div></div>
            <div className="bg-[#0f1420] border border-border rounded p-3">
              <div className="text-lg font-bold mono text-gray-100">
                {status.open_alerts}
                <span className="text-muted text-xs font-normal"> open · {status.active_tamper} tamper</span>
              </div>
              <div className="text-[10px] text-muted uppercase">Security events</div>
            </div>
          </div>
          <div className="mt-4 text-[11px] text-muted leading-relaxed">
            <span className="text-gray-400">Backend:</span> {status.ledger_backend} · last ledger hash <Hash v={status.ledger_last_hash} />
            <div className="mt-1">SHA-256 hashes + provenance metadata only — raw evidence never enters the ledger.</div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={() => run(() => api.sealEvidence(), "Evidence resealed.")} disabled={busy} className="px-3 py-1.5 rounded-md bg-accent text-bg text-xs font-semibold hover:bg-accent2 disabled:opacity-40">Re-Seal Evidence</button>
            <button onClick={() => run(() => api.verifyLedger(), "Ledger chain verified.")} disabled={busy} className="px-3 py-1.5 rounded-md bg-[#1a2130] border border-border text-gray-200 text-xs font-semibold hover:bg-[#212a3d] disabled:opacity-40">Verify Chain</button>
          </div>
        </div>
      </div>

      {notice && (
        <div className={`mb-5 px-4 py-3 rounded-lg border text-sm ${notice.kind === "ok" ? "bg-good/10 border-good/40 text-good" : "bg-bad/10 border-bad/40 text-bad"}`}>
          {notice.text}
          {notice.extra && <div className="mt-1 text-xs text-muted">{notice.extra}</div>}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* DEMO-ONLY tamper tool */}
        <div className="bg-card border border-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-gray-100 mb-1">Demo Tamper Tool <span className="text-xs text-warn font-normal">(DEMO-ONLY)</span></h3>
          <p className="text-xs text-muted mb-4">
            Alters one demonstration record so the next verification genuinely detects a SHA-256 violation.
            The original value is preserved and can be fully restored; security/audit/ledger history is never erased.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted">Evidence type</label>
              <select value={type} onChange={(e) => useType(e.target.value)} className="w-full mt-1 bg-[#0f1420] border border-border rounded px-2 py-1.5 text-sm text-gray-200">
                {Object.keys(FIELDS).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted">Record ID</label>
              <input value={recordId} onChange={(e) => setRecordId(e.target.value)} placeholder={`e.g. CR-0001 (${type})`} className="w-full mt-1 bg-[#0f1420] border border-border rounded px-2 py-1.5 text-sm text-gray-200 placeholder-muted" />
            </div>
            <div>
              <label className="text-xs text-muted">Field</label>
              <select value={field} onChange={(e) => setField(e.target.value)} className="w-full mt-1 bg-[#0f1420] border border-border rounded px-2 py-1.5 text-sm text-gray-200">
                {FIELDS[type].map((f) => <option key={f.key} value={f.key}>{f.key}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted">Tampered value</label>
              <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={FIELDS[type].find((f) => f.key === field)?.placeholder} className="w-full mt-1 bg-[#0f1420] border border-border rounded px-2 py-1.5 text-sm text-gray-200 placeholder-muted" />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => run(() => api.simulateTamper({ evidence_type: type, record_id: recordId, field_name: field, tampered_value: value }), "Demo tamper applied.")}
              disabled={busy || !recordId || !value}
              className="px-3 py-1.5 rounded-md bg-bad/20 border border-bad/50 text-bad text-xs font-semibold hover:bg-bad/30 disabled:opacity-40"
            >
              Apply Tamper
            </button>
            <button
              onClick={() => restoreKey && run(() => api.restoreTamperedEvidence({ evidence_type: restoreKey.split(":")[0], record_id: restoreKey.split(":")[1] }), "Original value restored.")}
              disabled={busy || !restoreKey}
              className="px-3 py-1.5 rounded-md bg-[#1a2130] border border-border text-gray-200 text-xs font-semibold hover:bg-[#212a3d] disabled:opacity-40"
            >
              Restore Selected
            </button>
          </div>

          <div className="mt-4">
            <h4 className="text-xs font-semibold text-gray-200 mb-2">Applied / Restored Tamper Records</h4>
            {tampers.length === 0 ? (
              <EmptyState title="No demo tampers yet" subtitle="Apply one above to see tamper detection in action." />
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {tampers.map((t) => (
                  <div key={t.id} className={`border rounded p-2 text-xs ${t.status === "Active" ? "border-bad/40 bg-bad/5" : "border-border bg-[#0f1420]"}`}>
                    <div className="flex justify-between items-center">
                      <span className="mono text-gray-200">{t.evidence_type_label || t.evidence_type} · {t.record_id}</span>
                      <span className={`uppercase tracking-wider ${t.status === "Active" ? "text-bad" : "text-good"}`}>{t.status}</span>
                    </div>
                    <div className="text-muted mt-0.5">
                      {t.field_name}: <span className="line-through text-bad/80">{t.tampered_value}</span>
                      {t.original_value !== undefined && <> → <span className="text-good">{t.original_value}</span></>}
                    </div>
                    <div className="text-[10px] text-muted mt-0.5">{t.applied_by} · {t.applied_at}{t.restored_by ? ` · restored ${t.restored_at}` : ""}</div>
                    {t.status === "Active" && (
                      <button onClick={() => setRestoreKey(`${t.evidence_type}:${t.record_id}`)} className="mt-1 text-accent underline text-[11px]">restore original value →</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Live security events */}
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-gray-100">Live Security Events</h3>
            <span className={`text-xs px-2 py-0.5 rounded border ${status.open_alerts ? "border-bad/50 text-bad" : "border-good/50 text-good"}`}>{status.open_alerts} open</span>
          </div>
          <p className="text-xs text-muted mb-3">Permanent, tamper-evident alerts — acknowledging marks them reviewed but never deletes them.</p>
          {events.length === 0 ? (
            <EmptyState title="No security events" subtitle="Flawless integrity so far — verify evidence to be sure." />
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {events.map((e) => (
                <div key={e.id} className={`border rounded p-2.5 text-xs ${e.status === "Open" ? "border-bad/40 bg-bad/5" : "border-border bg-[#0f1420]"}`}>
                  <div className="flex justify-between items-center gap-2">
                    <span className="mono text-gray-200">{e.evidence_type} · {e.record_id}{e.case_id ? ` · case ${e.case_id}` : ""}</span>
                    <span className={`text-[10px] uppercase tracking-wider ${e.status === "Open" ? "text-bad" : "text-muted"}`}>{e.status}</span>
                  </div>
                  <div className="text-gray-400 mt-1">Integrity mismatch detected — expected hash differs from current value.</div>
                  <div className="mt-1 grid grid-cols-2 gap-2 text-[10px] text-muted">
                    <div><span className="uppercase tracking-wider">recorded (sealed)</span><div><Hash v={e.expected_hash} /></div></div>
                    <div><span className="uppercase tracking-wider">current</span><div><Hash v={e.current_hash} /></div></div>
                  </div>
                  <div className="flex justify-between items-center mt-1.5">
                    <span className="text-[10px] text-muted">{e.detected_by} · {e.detected_at}</span>
                    {e.status === "Open" && (
                      <button onClick={() => run(() => api.ackSecurityEvent(e.id), "Event acknowledged.")} className="px-2 py-0.5 rounded border border-border text-gray-300 hover:bg-[#1a2130]">Acknowledge</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}