import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

export interface ErrorStateProps {
  title?: string;
  text?: string;
  action?: ReactNode;
}

export function ErrorState({
  title = "Xatolik yuz berdi",
  text = "Qayta urinib ko'ring.",
  action,
}: ErrorStateProps) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 p-8 text-center">
      <AlertTriangle aria-hidden="true" className="size-10 text-fire-text" />
      <p className="text-lg font-extrabold">{title}</p>
      {text && <p className="text-ink-2">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
