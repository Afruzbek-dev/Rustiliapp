import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "aria-label" | "children"> {
  "aria-label": string;
  icon: ReactNode;
}

export function IconButton({ icon, type = "button", ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex size-11 min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-sm)]",
        "bg-surface-2 text-ink border-2 border-border-strong",
        "transition-transform duration-150 active:translate-y-[2px]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong",
        "disabled:opacity-60 disabled:pointer-events-none",
      )}
      {...rest}
    >
      <span aria-hidden="true" className="inline-flex">
        {icon}
      </span>
    </button>
  );
}
