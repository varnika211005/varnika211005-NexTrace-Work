import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const linkBase = "flex items-center gap-3 px-4 py-2 text-sm rounded-md mx-2 transition-colors";
const active = "bg-[#152030] text-accent border-l-2 border-accent -ml-[2px] pl-[18px]";
const inactive = "text-muted hover:text-gray-200 hover:bg-[#131926]";

const OVERVIEW_ITEMS = [
  { to: "/", label: "Dashboard", icon: "◧" },
  { to: "/cases", label: "Cases", icon: "▤" },
  { to: "/entities", label: "Entities", icon: "☰" },
  { to: "/network", label: "Network", icon: "◎" },
  { to: "/timeline", label: "Timeline", icon: "⏱" },
  { to: "/evidence", label: "Evidence", icon: "▣" },
  { to: "/entity-resolution", label: "Entity Resolution", icon: "⇄" },
  { to: "/access-requests", label: "Access Requests", icon: "✉" },
  { to: "/reports", label: "Reports", icon: "▦" },
];

const ADMIN_ITEMS = [
  { to: "/admin/ingestion", label: "Data Ingestion", icon: "⇧" },
  { to: "/admin/processing", label: "Processing Pipeline", icon: "⚙" },
  { to: "/admin/audit", label: "Audit & Provenance", icon: "◉" },
  { to: "/admin/users", label: "User Management", icon: "◫" },
  { to: "/admin/access-control", label: "Access Control", icon: "🔒" },
  { to: "/admin/security", label: "Security & Integrity", icon: "🛡" },
  { to: "/admin/backup", label: "Backup & Restore", icon: "⬇" },
];

const ACCOUNT_ITEMS = [{ to: "/profile", label: "My Profile", icon: "◍" }];

function NavGroup({ label, items }: { label: string; items: { to: string; label: string; icon: string }[] }) {
  return (
    <div className="mb-2">
      <div className="px-5 pb-2 pt-3 text-[10px] uppercase tracking-wider text-muted font-semibold">{label}</div>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          className={({ isActive }) => `${linkBase} ${isActive ? active : inactive}`}
        >
          <span className="text-base w-4 text-center">{item.icon}</span>
          {item.label}
        </NavLink>
      ))}
    </div>
  );
}

export default function Sidebar({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { user, isAdmin } = useAuth();

  return (
    <aside className={`fixed left-0 top-0 w-64 shrink-0 bg-panel border-r border-border flex flex-col h-screen z-20 transition-transform duration-300 ease-in-out ${open ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="px-5 py-5 border-b border-border">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <img src="/logo/nextracelogo.png" alt="NexTrace" className="w-12 h-12 object-contain shrink-0" />
            <div>
              <div className="font-bold text-gray-100 tracking-wide text-sm">NEXTRACE</div>
              <div className="text-[10px] text-muted uppercase tracking-wider">Criminal Network Analysis</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onToggle}
            title="Close sidebar"
            aria-label="Close sidebar"
            className="text-muted hover:text-gray-200 transition-colors text-sm leading-none p-1 -mr-1"
          >
            ◀
          </button>
        </div>
      </div>

      <nav className="flex-1 py-2 overflow-y-auto">
        <NavGroup label="Overview" items={OVERVIEW_ITEMS} />
        {isAdmin && <NavGroup label="Administration" items={ADMIN_ITEMS} />}
        <NavGroup label="Account" items={ACCOUNT_ITEMS} />
      </nav>

      <div className="px-5 py-4 border-t border-border">
        <div className="text-xs text-gray-300 font-medium">{user?.name}</div>
        <div className="text-[10px] text-muted uppercase tracking-wider mt-0.5">
          {user?.analyst_id} · {isAdmin ? "Admin Investigator" : "Investigator"}
        </div>
      </div>
    </aside>
  );
} 