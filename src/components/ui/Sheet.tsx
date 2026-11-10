import type { ReactNode } from "react";
import { cn } from "./cn";

export interface SheetProps {
  variant: "ok" | "error";
  open?: boolean;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}

export function Sheet({ variant, open = true, title, children, actions }: SheetProps) {
  if (!open) return null;
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 rounded-t-[var(--radius-xl)] border-t-2 p-5 pb-8",
        variant === "ok"
          ? "border-ok bg-ok-bg text-ok-text"
          : "border-fire bg-fire-bg text-fire-text",
      )}
    >
      <p className="text-lg font-extrabold">{title}</p>
      {children && <div className="mt-1 text-base">{children}</div>}
      {actions && <div className="mt-4">{actions}</div>}
    </div>
  );
}
