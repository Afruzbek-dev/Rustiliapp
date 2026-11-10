import { cn } from "./cn";

export type ProgressColor = "brand" | "ok" | "info" | "fire";

const colors: Record<ProgressColor, string> = {
  brand: "bg-brand",
  ok: "bg-ok",
  info: "bg-info",
  fire: "bg-fire",
};

export interface ProgressBarProps {
  value: number;
  max?: number;
  color?: ProgressColor;
  label?: string;
}

export function ProgressBar({ value, max = 100, color = "brand", label }: ProgressBarProps) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const safeValue = Number.isFinite(value) ? value : 0;
  const clamped = Math.min(Math.max(safeValue, 0), safeMax);
  const pct = (clamped / safeMax) * 100;
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-label={label?.trim() ? label : "Jarayon"}
      className="h-3 w-full overflow-hidden rounded-full bg-surface-2"
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-150", colors[color])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
