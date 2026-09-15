import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";

export default function Profile() {
  const { user, isAdmin } = useAuth();
  const [me, setMe] = useState<any>(null);

  useEffect(() => {
    api.me().then(setMe).catch(() => {});
  }, []);

  return (
    <div>
      <PageHeader title="My Profile" subtitle="Account details and session information." />
      <div className="max-w-lg bg-card border border-border rounded-lg p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-accent to-accent2 flex items-center justify-center text-bg font-bold text-lg">
            {user?.name?.[0] || "?"}
          </div>
          <div>
            <div className="text-gray-100 font-semibold">{user?.name}</div>
            <div className="text-xs text-muted mono">{user?.analyst_id}</div>
          </div>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between py-2 border-b border-border/60"><span className="text-muted">Role</span><span className="text-gray-200">{isAdmin ? "Admin Investigator" : "Investigator"}</span></div>
          <div className="flex justify-between py-2 border-b border-border/60"><span className="text-muted">Status</span><span className="text-good">{me?.status || "Active"}</span></div>
          <div className="flex justify-between py-2 border-b border-border/60"><span className="text-muted">Assigned Cases</span><span className="text-gray-200 mono">{me?.assigned_cases ?? "—"}</span></div>
          <div className="flex justify-between py-2"><span className="text-muted">Last Active</span><span className="text-gray-200 mono text-xs">{me?.last_active || "—"}</span></div>
        </div>
        <div className="mt-5 pt-4 border-t border-border text-[11px] text-muted leading-relaxed">
          Sessions expire after 12 hours. All actions taken under this account are recorded in the audit
          log{isAdmin ? " (Administration → Audit & Provenance)." : "."}
        </div>
      </div>
    </div>
  );
}
