import Link from "next/link";
import { cn } from "@/components/ui/cn";
import type { RatingKind, RatingPeriod } from "@/server/rating";

const linkCls = (active: boolean) =>
  cn(
    "inline-flex min-h-11 flex-1 items-center justify-center rounded-[var(--radius-sm)] px-3 text-sm font-bold",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong",
    active ? "bg-card text-ink" : "text-ink-2",
  );

function Group<T extends string>({
  label,
  items,
  value,
  href,
}: {
  label: string;
  items: { id: T; label: string }[];
  value: T;
  href: (id: T) => string;
}) {
  return (
    <nav aria-label={label} className="flex gap-1 rounded-[var(--radius-md)] bg-surface-2 p-1">
      {items.map((it) => (
        <Link
          key={it.id}
          href={href(it.id)}
          aria-current={it.id === value ? "page" : undefined}
          className={linkCls(it.id === value)}
        >
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

/** Server-rendered tab and period links; state lives in ?kind=&period=. */
export function RatingTabs({ kind, period }: { kind: RatingKind; period: RatingPeriod }) {
  return (
    <div className="flex flex-col gap-2">
      <Group
        label="Reyting turi"
        value={kind}
        items={[
          { id: "speaking", label: "Gapirish" },
          { id: "xp", label: "XP" },
        ]}
        href={(id) => `/rating?kind=${id}&period=${period}`}
      />
      <Group
        label="Davr"
        value={period}
        items={[
          { id: "week", label: "Hafta" },
          { id: "month", label: "Oy" },
        ]}
        href={(id) => `/rating?kind=${kind}&period=${id}`}
      />
    </div>
  );
}
