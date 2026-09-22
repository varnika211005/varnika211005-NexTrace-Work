export default function Footer() {
  return (
    <footer className="mt-auto shrink-0 h-9 min-h-9 border-t border-border bg-panel/40 flex items-center px-6">
      <div className="flex items-center justify-between gap-4 w-full max-w-[1600px] mx-auto text-[11px] text-muted">
        <span className="min-w-0 truncate">
          NexTrace | AI-Powered Criminal Network Analysis System | Data. Intelligence. Safer Communities.
        </span>
        <span className="shrink-0 whitespace-nowrap border border-border rounded px-2 py-0.5 text-[10px] text-gray-300">
          SIH 2026 Prototype
        </span>
      </div>
    </footer>
  );
}