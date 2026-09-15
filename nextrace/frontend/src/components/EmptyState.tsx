import { ReactNode } from "react";
export default function EmptyState({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-lg p-10 text-center">
      <div className="text-gray-200 font-medium mb-2">{title}</div>
      {subtitle && <p className="text-muted text-sm mb-5">{subtitle}</p>}
      {action}
    </div>
  );
}
