import { Link } from "react-router-dom";

const QUICK_LINKS = [
  { to: "/", label: "Dashboard" },
  { to: "/cases", label: "Cases" },
  { to: "/entities", label: "Entities" },
  { to: "/network", label: "Network" },
  { to: "/evidence", label: "Evidence" },
  { to: "/timeline", label: "Timeline" },
  { to: "/reports", label: "Reports" },
  { to: "/admin/security", label: "Security", admin: true },
];

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-border bg-panel/40">
      <div className="mx-auto max-w-7xl px-6 py-10 grid grid-cols-2 lg:grid-cols-4 gap-8">
        <div>
          <div className="flex items-center gap-2.5 mb-3">
            <img src="/logo/nextrace-logo.png" alt="NexTrace" className="w-10 h-10 object-contain" />
            <div>
              <div className="font-bold text-gray-100 tracking-wide text-sm">NEXTRACE</div>
              <div className="text-[10px] text-muted uppercase tracking-wider">AI-Powered Criminal Network Analysis System</div>
            </div>
          </div>
          <p className="text-xs text-muted leading-relaxed">Data. Intelligence. Safer Communities.</p>
        </div>

        <div>
          <h4 className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-3">Quick Links</h4>
          <ul className="space-y-1.5">
            {QUICK_LINKS.map((l) => (
              <li key={l.to}>
                <Link to={l.to} className="text-xs text-muted hover:text-gray-200 transition-colors">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-3">Platform Info</h4>
          <ul className="space-y-1.5">
            <li className="text-xs text-muted">SIH 2026 Prototype</li>
            <li className="text-xs text-muted">Synthetic / fictional data only</li>
            <li className="text-xs text-muted">Blockchain &amp; Cybersecurity</li>
            <li className="text-xs text-muted">Immutable hash-chain ledger</li>
            <li className="text-xs text-muted">SHA-256 evidence integrity</li>
          </ul>
        </div>

        <div className="flex flex-col justify-center items-start gap-2">
          <div className="text-[10px] uppercase tracking-[0.25em] text-accent/80 font-semibold leading-relaxed">
            Investigate
            <br />
            Connect
            <br />
            Secure
          </div>
          <div className="text-[10px] text-muted">A decision-support tool for investigative intelligence.</div>
        </div>
      </div>

      <div className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-muted">
          <span>NexTrace — AI for Safer Communities</span>
          <span>© 2026 NexTrace — SIH 2026 Prototype</span>
        </div>
      </div>
    </footer>
  );
}