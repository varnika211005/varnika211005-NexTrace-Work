export function SeverityBadge({ severity }: { severity: string }) {
  const styles: Record<string, string> = {
    High: "bg-bad/10 text-bad border-bad/30",
    Medium: "bg-warn/10 text-warn border-warn/30",
    Low: "bg-muted/10 text-muted border-border",
  };
  return <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${styles[severity] || styles.Low}`}>{severity}</span>;
}
export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    Active: "bg-good/10 text-good border-good/30",
    Inactive: "bg-muted/10 text-muted border-border",
    Pending: "bg-warn/10 text-warn border-warn/30",
    Confirmed: "bg-good/10 text-good border-good/30",
    Rejected: "bg-bad/10 text-bad border-bad/30",
    Completed: "bg-good/10 text-good border-good/30",
    Running: "bg-accent/10 text-accent border-accent/30",
    Queued: "bg-muted/10 text-muted border-border",
    Failed: "bg-bad/10 text-bad border-bad/30",
  };
  return <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${styles[status] || styles.Pending}`}>{status}</span>;
}
