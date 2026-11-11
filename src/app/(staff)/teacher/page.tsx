import type { ReactNode } from "react";
import { Activity, ClipboardCheck, GraduationCap, Inbox, TrendingUp, Users } from "lucide-react";
import { ActivityChart } from "@/components/staff/ActivityChart";
import { CohortSelect } from "@/components/staff/CohortSelect";
import { CuratorTable } from "@/components/staff/CuratorTable";
import { IdleStudents } from "@/components/staff/IdleStudents";
import { KpiTile } from "@/components/staff/KpiTile";
import { LessonCompletion } from "@/components/staff/LessonCompletion";
import { RequestsCard } from "@/components/staff/RequestsCard";
import { Card, EmptyState } from "@/components/ui";
import { tashkentDay } from "@/lib/gamification/day";
import { requireStaff } from "@/server/guards";
import { remindedToday } from "@/server/teacher-reminders";
import { getTeacherDashboard, listCohorts, pickCohort } from "@/server/teacher-stats";
import { approveRequestAction, rejectRequestAction, remindStudentAction } from "./actions";

export const dynamic = "force-dynamic";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-extrabold">{title}</h2>
        {children}
      </section>
    </Card>
  );
}

export default async function TeacherDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireStaff();
  const sp = await searchParams;
  const cohorts = await listCohorts();
  const cohort = pickCohort(cohorts, sp.cohort);

  if (!cohort) {
    return (
      <main className="p-4">
        <h1 className="mb-4 text-2xl font-extrabold">Bosh panel</h1>
        <EmptyState
          icon={<GraduationCap className="size-10" />}
          title="Hali guruh yo'q"
          text="Birinchi guruh yaratilgach, statistika shu yerda ko'rinadi."
        />
      </main>
    );
  }

  const now = new Date();
  const d = await getTeacherDashboard(cohort.id);
  const reminded = await remindedToday(
    d.idle.map((s) => s.studentId),
    now,
  );
  const k = d.kpis;

  return (
    <main className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">Bosh panel</h1>
        <CohortSelect cohorts={cohorts} selectedId={cohort.id} />
      </div>
      <p className="text-ink-2">Guruh: {cohort.name}</p>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr))]">
        <KpiTile
          icon={<Users className="size-6" />}
          label="Faol o'quvchilar"
          value={k.activeStudents}
          hint={`jami ${k.totalStudents} ta`}
        />
        <KpiTile icon={<Activity className="size-6" />} label="Bugun faol" value={k.activeToday} />
        <KpiTile icon={<Inbox className="size-6" />} label="Ruxsat kutmoqda" value={k.pendingRequests} />
        <KpiTile icon={<ClipboardCheck className="size-6" />} label="Tekshirilmagan" value={k.unreviewedSubmissions} />
        <KpiTile
          icon={<TrendingUp className="size-6" />}
          label="O'rtacha progress"
          value={k.avgProgress.toFixed(1)}
          hint="dars qismi / o'quvchi"
        />
      </div>

      <Section title="Faollik, so'nggi 14 kun">
        <ActivityChart data={d.activity} />
      </Section>

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))]">
        <Section title="Ruxsat so'rovlari">
          <RequestsCard
            requests={d.requests}
            approveAction={approveRequestAction}
            rejectAction={rejectRequestAction}
          />
        </Section>
        <Section title="Darslar bo'yicha tugatish">
          <LessonCompletion rows={d.lessons} />
        </Section>
      </div>

      <Section title="Kuratorlar">
        <CuratorTable rows={d.curators} />
      </Section>

      <Section title="Oxirgi 3 kunda faol bo'lmaganlar">
        <IdleStudents
          students={d.idle.map((s) => ({ ...s, remindedToday: reminded.has(s.studentId) }))}
          cohortId={cohort.id}
          today={tashkentDay(now)}
          remindAction={remindStudentAction}
        />
      </Section>
    </main>
  );
}
