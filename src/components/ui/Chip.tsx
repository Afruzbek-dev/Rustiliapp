import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export type ChipTone = "neutral" | "brand" | "ok" | "fire" | "info";

const tones: Record<ChipTone, string> = {
  neutral: "bg-surface-2 text-ink-2",
  brand: "bg-brand text-ink",
  ok: "bg-ok-bg text-ok-text",
  fire: "bg-fire-bg text-fire-text",
  info: "bg-info-bg text-info-strong",
};

export interface ChipProps extends Omit<HTMLAttributes<HTMLSpanElement>, "className"> {
  tone?: ChipTone;
}

export function Chip({ tone = "neutral", ...rest }: ChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold",
        tones[tone],
      )}
      {...rest}
    />
  );
}
