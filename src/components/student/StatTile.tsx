import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

export interface StatTileProps {
  icon: ReactNode;
  label: string;
  value: string | number;
  tone?: "brand" | "fire" | "info";
}

const iconTones = {
  brand: "text-brand-text",
  fire: "text-fire-text",
  info: "text-info-strong",
};

export function StatTile({ icon, label, value, tone = "brand" }: StatTileProps) {
  return (
    <div className="flex min-h-11 flex-1 flex-col items-center gap-1 rounded-[var(--radius-lg)] border-2 border-border bg-card px-2 py-3 text-center">
      <span aria-hidden="true" className={cn("inline-flex", iconTones[tone])}>
        {icon}
      </span>
      <span className="text-xl font-extrabold">{value}</span>
      <span className="text-xs font-bold text-ink-2">{label}</span>
    </div>
  );
}
