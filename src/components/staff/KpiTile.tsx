import type { ReactNode } from "react";

export interface KpiTileProps {
  icon: ReactNode;
  label: string;
  value: string | number;
  hint?: string;
}

/** Headline number: ink text (never the series colour), the icon carries the only accent. */
export function KpiTile({ icon, label, value, hint }: KpiTileProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[var(--radius-lg)] border-2 border-border bg-card p-4">
      <span aria-hidden="true" className="inline-flex text-ink-2">
        {icon}
      </span>
      <span className="text-3xl font-extrabold text-ink">{value}</span>
      <span className="text-sm font-bold text-ink-2">{label}</span>
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
    </div>
  );
}
