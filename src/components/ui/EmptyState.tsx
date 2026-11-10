import type { ReactNode } from "react";

export interface StateProps {
  icon: ReactNode;
  title: string;
  text?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, text, action }: StateProps) {
  return (
    <div className="flex flex-col items-center gap-2 p-8 text-center">
      <span aria-hidden="true" className="text-ink-3">
        {icon}
      </span>
      <p className="text-lg font-extrabold">{title}</p>
      {text && <p className="text-ink-2">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
