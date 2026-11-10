import { BookOpen, Flame, Trophy, Zap } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";
import { ContinueCard } from "@/components/student/ContinueCard";
import { DailyTasks } from "@/components/student/DailyTasks";
import { ReviewDueCard } from "@/components/student/ReviewDueCard";
import { StatTile } from "@/components/student/StatTile";
import { StreakCelebration } from "@/components/student/StreakCelebration";
import { WeekStrip } from "@/components/student/WeekStrip";
import { createClient } from "@/lib/supabase/server";
import { getDashboard } from "@/server/dashboard";
import { requireStudent } from "@/server/guards";
import { ensureStreakBonus } from "@/server/streak-bonus";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { user } = await requireStudent();

  // Streak-bonus check runs before the dashboard read so XP and streak shown include it.
  // Failures are logged and never break the page.
  let celebrate: { streak: number; day: string } | null = null;
  let bonusStreak = 0;
  try {
    const b = await ensureStreakBonus(await createClient(), user.id);
    bonusStreak = b.streak;
    if (b.milestone !== null && b.awarded) celebrate = { streak: b.milestone, day: b.today };
  } catch (err) {
    console.error("streak bonus failed", err instanceof Error ? err.message : "unknown error");
  }
  const d = await getDashboard(user.id);
  const streak = Math.max(d.streak, bonusStreak);

  return (
    <main className="flex flex-col gap-4 p-4">
      <header>
        <h1 className="text-2xl font-extrabold">Salom{d.firstName ? `, ${d.firstName}` : ""}</h1>
        {d.groupLabel && <p className="text-ink-2">{d.groupLabel}</p>}
      </header>

      {d.isEmpty ? (
        <EmptyState
          icon={<BookOpen className="size-10" />}
          title="Birinchi darsni boshlang"
          text="Yo'lingiz shu yerdan boshlanadi."
          action={<Button href="/path">Yo&apos;lga o&apos;tish</Button>}
        />
      ) : (
        <>
          <section aria-label="Statistika" className="flex gap-2">
            <StatTile icon={<Flame className="size-6" />} label="Streak" value={streak} tone="fire" />
            <StatTile icon={<Zap className="size-6" />} label="XP" value={d.totalXp} tone="brand" />
            <StatTile
              icon={<Trophy className="size-6" />}
              label="Haftalik o'rin"
              value={d.weeklyRank ?? "-"}
              tone="info"
            />
          </section>
          <WeekStrip week={d.week} />
          {d.currentPart && <ContinueCard part={d.currentPart} />}
          <DailyTasks tasks={d.tasks} />
          <ReviewDueCard count={d.dueCards} />
        </>
      )}
      {celebrate && <StreakCelebration streak={celebrate.streak} day={celebrate.day} />}
    </main>
  );
}
