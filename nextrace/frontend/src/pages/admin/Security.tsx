import { useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader";
import { api } from "../../api/client";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-3 border-b border-border/60 last:border-0">
      <span className="text-sm text-gray-300">{label}</span>
      <span className="text-sm text-good font-medium">{value}</span>
    </div>
  );
}

export default function Security() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    api.security().then(setData);
  }, []);

  if (!data) return <div className="text-muted text-sm">Loading…</div>;

  return (
    <div>
      <PageHeader title="Security & Access" subtitle="System-level security posture for this NexTrace deployment." />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-2 h-2 rounded-full bg-good inline-block" />
            <span className="text-good font-semibold text-sm uppercase tracking-wider">System Status: {data.system_status}</span>
          </div>
          <Row label="Authentication" value={data.authentication} />
          <Row label="Role-based Access Control" value={data.role_based_access_control} />
          <Row label="Audit Logging" value={data.audit_logging} />
          <Row label="Data Provenance" value={data.data_provenance} />
          <Row label="Encryption at Rest" value={data.encryption_at_rest} />
        </div>

        <div className="bg-card border border-border rounded-lg p-6">
          <h3 className="text-sm font-semibold text-gray-100 mb-3">Current Session</h3>
          <div className="text-sm text-gray-300 space-y-1.5">
            <div><span className="text-muted">Analyst ID:</span> <span className="mono">{data.current_admin.analyst_id}</span></div>
            <div><span className="text-muted">Name:</span> {data.current_admin.name}</div>
            <div><span className="text-muted">Role:</span> Admin Investigator</div>
          </div>
          <div className="mt-5 pt-4 border-t border-border text-xs text-muted leading-relaxed">
            This is a local demonstration deployment using synthetic data and an on-disk SQLite database.
            No secrets or credentials are displayed here by design.
          </div>
        </div>
      </div>
    </div>
  );
}
