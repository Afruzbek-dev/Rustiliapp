import { Trophy } from "lucide-react";
import { EmptyState } from "@/components/ui";
import { PrizeBanner } from "@/components/student/PrizeBanner";
import { Podium } from "@/components/student/Podium";
import { RankRow } from "@/components/student/RankRow";
import { RatingTabs } from "@/components/student/RatingTabs";
import { StreakCelebration } from "@/components/student/StreakCelebration";
import { tashkentDay } from "@/lib/gamification/day";
import { createClient } from "@/lib/supabase/server";
import { requireStudent } from "@/server/guards";
import { getRating, parseKind, parsePeriod } from "@/server/rating";
import { ensureStreakBonus } from "@/server/streak-bonus";

export const dynamic = "force-dynamic";

export default async function RatingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const kind = parseKind(sp.kind);
  const period = parsePeriod(sp.period);
  const { user } = await requireStudent();

  // Visiting the rating triggers the streak-bonus check. It must never break the page.
  let milestone: number | null = null;
  try {
    milestone = (await ensureStreakBonus(await createClient(), user.id)).milestone;
  } catch (err) {
    console.error("streak bonus failed", err instanceof Error ? err.message : "unknown error");
  }

  const r = await getRating(user.id, kind, period);
  const ownId = r.own?.student_id ?? null;

  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="text-2xl font-extrabold">Reyting</h1>
      <RatingTabs kind={kind} period={period} />

      <PrizeBanner kind={kind} />

      {r.empty ? (
        <EmptyState
          icon={<Trophy className="size-10" />}
          title="Hali reyting yo'q"
          text="Topshiriqlarni bajaring, natijalar shu yerda ko'rinadi."
        />
      ) : (
        <>
          <Podium entries={r.podium} kind={kind} ownId={ownId} />
          {(r.rows.length > 0 || r.ineligible.length > 0) && (
            <ul aria-label="Reyting ro'yxati" className="flex flex-col gap-2">
              {r.rows.map((row) => (
                <RankRow key={row.student_id} row={row} kind={kind} own={row.student_id === ownId} />
              ))}
              {r.ineligible.map((row) => (
                <RankRow key={row.student_id} row={row} kind={kind} own={row.student_id === ownId} />
              ))}
            </ul>
          )}
        </>
      )}

      {milestone !== null && <StreakCelebration streak={milestone} day={tashkentDay(new Date())} />}
    </main>
  );
}
