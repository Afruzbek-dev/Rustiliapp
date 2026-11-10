import { cn } from "@/components/ui/cn";
import type { LeaderboardRow, RatingKind } from "@/server/rating";

export function formatScore(kind: RatingKind, score: number): string {
  return kind === "xp" ? `${Math.round(score)} XP` : `${score.toFixed(1)} ball`;
}

export interface RankRowProps {
  row: LeaderboardRow;
  kind: RatingKind;
  own?: boolean;
}

/** List row for places 4+ and for students below the eligibility threshold. */
export function RankRow({ row, kind, own = false }: RankRowProps) {
  return (
    <li
      aria-current={own ? "true" : undefined}
      data-own={own ? "true" : undefined}
      className={cn(
        "flex min-h-14 items-center gap-3 rounded-[var(--radius-md)] border-2 px-3 py-2",
        own ? "border-brand-shadow bg-brand text-ink" : "border-border bg-card text-ink",
      )}
    >
      <span className="w-7 shrink-0 text-center text-base font-extrabold">
        {row.eligible ? row.rank : <span aria-label="O'rin yo'q">&ndash;</span>}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-extrabold",
          own ? "bg-card text-ink" : "bg-surface-2 text-ink",
        )}
      >
        {initialsOf(row.display_name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold">
          {row.display_name}
          {own && <span className="ml-2 text-sm font-extrabold">(Siz)</span>}
        </span>
        {!row.eligible && (
          <span className="mt-1 inline-block rounded-full bg-surface-2 px-2 py-0.5 text-xs font-bold text-ink-2">
            Kamida 8 ta topshiriq kerak
          </span>
        )}
      </span>
      <span
        className={cn(
          "shrink-0 rounded-full px-3 py-1 text-sm font-extrabold",
          own ? "bg-card text-ink" : "bg-surface-2 text-ink",
        )}
      >
        {formatScore(kind, row.score)}
      </span>
    </li>
  );
}

export function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p.charAt(0).toUpperCase())
      .join("") || "?"
  );
}
