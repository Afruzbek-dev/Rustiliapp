import { Info } from "lucide-react";
import type { RatingKind } from "@/server/rating";

/** Prize note, shown on the speaking leaderboard only. */
export function PrizeBanner({ kind }: { kind: RatingKind }) {
  if (kind !== "speaking") return null;
  return (
    <p className="flex items-start gap-2 rounded-[var(--radius-md)] bg-info-bg p-3 text-sm font-bold text-ink">
      <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-info-strong" />
      Oy yakunida gapirish bo&apos;yicha top-3 ustozdan sovg&apos;a oladi. Natijalarni ustoz tasdiqlaydi.
    </p>
  );
}
