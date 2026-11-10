import { cn } from "@/components/ui/cn";
import type { LeaderboardRow, RatingKind } from "@/server/rating";
import { formatScore, initialsOf } from "./RankRow";

const PLACE = [
  { name: "1-o'rin", color: "#FFD60A", stand: "h-24", avatar: "size-20 text-2xl" },
  { name: "2-o'rin", color: "#D9D6CC", stand: "h-16", avatar: "size-16 text-xl" },
  { name: "3-o'rin", color: "#E39B6B", stand: "h-12", avatar: "size-16 text-xl" },
] as const;

// Visual order: 2nd, 1st, 3rd (indexes into the best-first podium array).
const ORDER = [1, 0, 2] as const;

export interface PodiumProps {
  /** Best-first, at most 3. Missing places render as empty slots. */
  entries: LeaderboardRow[];
  kind: RatingKind;
  ownId?: string | null;
}

export function Podium({ entries, kind, ownId = null }: PodiumProps) {
  return (
    <ol aria-label="Top 3" className="flex items-end justify-center gap-2">
      {ORDER.map((slot) => {
        const entry = entries[slot];
        const place = PLACE[slot];
        const own = !!entry && entry.student_id === ownId;
        return (
          <li
            key={slot}
            data-slot={slot + 1}
            data-own={own ? "true" : undefined}
            className="flex min-w-0 flex-1 flex-col items-center gap-1"
          >
            {entry ? (
              <>
                <span
                  aria-hidden="true"
                  style={{ borderColor: place.color }}
                  className={cn(
                    "inline-flex items-center justify-center rounded-full border-4 bg-card font-extrabold text-ink",
                    place.avatar,
                  )}
                >
                  {initialsOf(entry.display_name)}
                </span>
                <span className="max-w-full truncate text-sm font-bold text-ink">
                  {entry.display_name}
                  {own && " (Siz)"}
                </span>
                <span
                  className={cn(
                    "rounded-full px-3 py-1 text-sm font-extrabold text-ink",
                    own ? "bg-brand" : "bg-surface-2",
                  )}
                >
                  {formatScore(kind, entry.score)}
                </span>
              </>
            ) : (
              <span
                data-empty="true"
                aria-label={`${place.name}: bo'sh`}
                className={cn(
                  "inline-flex items-center justify-center rounded-full border-4 border-dashed border-border-strong text-ink-3",
                  place.avatar,
                )}
              >
                ?
              </span>
            )}
            <div
              style={{ borderTopColor: place.color }}
              className={cn(
                "flex w-full items-start justify-center rounded-t-[var(--radius-sm)] border-t-[6px] bg-surface-2 pt-2",
                place.stand,
              )}
            >
              <span className="text-2xl font-extrabold text-ink">
                <span className="sr-only">{place.name}: </span>
                {entry ? entry.rank : slot + 1}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
