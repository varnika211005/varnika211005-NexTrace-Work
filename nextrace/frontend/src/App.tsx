import { Routes, Route, Link, Navigate, useLocation } from "react-router-dom";
import { useState } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ProtectedRoute, AdminRoute } from "./components/Guards";
import Sidebar from "./components/Sidebar";
import Footer from "./components/Footer";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Entities from "./pages/Entities";
import EntityProfile from "./pages/EntityProfile";
import NetworkGraph from "./pages/NetworkGraph";
import Timeline from "./pages/Timeline";
import Evidence from "./pages/Evidence";
import Cases from "./pages/Cases";
import CaseDetail from "./pages/CaseDetail";
import EntityResolution from "./pages/EntityResolution";
import AccessRequests from "./pages/AccessRequests";
import Reports from "./pages/Reports";
import Profile from "./pages/Profile";
import AdminIngestion from "./pages/admin/Ingestion";
import AdminProcessing from "./pages/admin/Processing";
import AdminAudit from "./pages/admin/Audit";
import AdminUsers from "./pages/admin/Users";
import AdminAccessControl from "./pages/admin/AccessControl";
import AdminSecurity from "./pages/admin/Security";
import AdminBackup from "./pages/admin/Backup";

function Shell({ children }: { children: React.ReactNode }) {
  const { user, isAdmin, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { pathname } = useLocation();
  const isNetwork = pathname === "/network";
  return (
    <div className="bg-bg min-h-screen">
      <Sidebar open={sidebarOpen} onToggle={() => setSidebarOpen((v) => !v)} />
      <div className={`flex flex-col min-w-0 transition-[padding-left] duration-300 ease-in-out ${sidebarOpen ? "pl-64" : "pl-0"} ${isNetwork ? "h-screen overflow-hidden" : "min-h-screen"}`}>
        <header className="h-16 border-b border-border bg-panel/60 backdrop-blur flex items-center justify-between px-6 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
              aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
              className="text-muted hover:text-gray-200 transition-colors text-sm"
            >
              {sidebarOpen ? "◀" : "▶"}
            </button>
            <Link to="/" className="text-sm text-muted hover:text-gray-200">
              NexTrace / Investigation Workspace
            </Link>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="text-muted">
              <span className="text-gray-300 font-medium">{user?.name}</span>{" "}
              <span className="px-2 py-0.5 rounded border border-border text-[10px] uppercase tracking-wider ml-1">
                {isAdmin ? "Admin Investigator" : "Investigator"}
              </span>
            </span>
            <button onClick={logout} className="text-muted hover:text-bad transition-colors">
              Sign Out
            </button>
          </div>
        </header>
        <main className={`flex-1 min-w-0 ${isNetwork ? "p-0 min-h-0 overflow-hidden" : "p-6"}`}>{children}</main>
        <Footer />
      </div>
    </div>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Shell>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/entities" element={<Entities />} />
                <Route path="/entities/:id" element={<EntityProfile />} />
                <Route path="/network" element={<NetworkGraph />} />
                <Route path="/timeline" element={<Timeline />} />
                <Route path="/evidence" element={<Evidence />} />
                <Route path="/cases" element={<Cases />} />
                <Route path="/cases/:caseId" element={<CaseDetail />} />
                <Route path="/entity-resolution" element={<EntityResolution />} />
                <Route path="/access-requests" element={<AccessRequests />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/admin/ingestion" element={<AdminRoute><AdminIngestion /></AdminRoute>} />
                <Route path="/admin/processing" element={<AdminRoute><AdminProcessing /></AdminRoute>} />
                <Route path="/admin/audit" element={<AdminRoute><AdminAudit /></AdminRoute>} />
                <Route path="/admin/users" element={<AdminRoute><AdminUsers /></AdminRoute>} />
                <Route path="/admin/access-control" element={<AdminRoute><AdminAccessControl /></AdminRoute>} />
                <Route path="/admin/security" element={<AdminRoute><AdminSecurity /></AdminRoute>} />
                <Route path="/admin/backup" element={<AdminRoute><AdminBackup /></AdminRoute>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Shell>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}