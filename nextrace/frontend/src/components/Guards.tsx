import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="text-muted text-sm p-6">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function AdminRoute({ children }: { children: ReactNode }) {
  const { isAdmin, loading } = useAuth();
  if (loading) return <div className="text-muted text-sm p-6">Loading…</div>;
  if (!isAdmin) {
    return (
      <div className="bg-card border border-border rounded-lg p-10 text-center max-w-lg mx-auto mt-16">
        <div className="text-bad text-sm font-semibold uppercase tracking-wider mb-2">Access Restricted</div>
        <p className="text-gray-300 text-sm mb-5">
          You do not have permission to access this administrative module. This area is limited to
          Admin Investigators.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
