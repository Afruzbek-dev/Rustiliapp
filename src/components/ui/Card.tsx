import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "className"> {
  tone?: "default" | "muted";
}

export function Card({ tone = "default", ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border-2 border-border p-4",
        tone === "default" ? "bg-card" : "bg-surface-2",
      )}
      {...rest}
    />
  );
}
