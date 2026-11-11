import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Flame, Zap } from "lucide-react";
import { StudentActions } from "@/components/staff/manage/StudentActions";
import { formatDay, formatInstantDay, StatusChip } from "@/components/staff/manage/status";
import { Card, Chip, ProgressBar } from "@/components/ui";
import { requireStaff } from "@/server/guards";
import { getStudentDetail } from "@/server/manage-read";
import {
  approveStudentAction,
  expireStudentAction,
  linkTelegramAction,
  moveStudentAction,
  rejectStudentAction,
  setExpiryAction,
} from "../../manage-actions";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { audio: "Audio", video: "Video", text: "Matn" };

export default async function StudentDetailPage({ params }: { params: Promise<{ enrollmentId: string }> }) {
  await requireStaff();
  const { enrollmentId } = await params;
  // RLS decides: a teacher who does not teach this cohort gets no row, so the page is a plain 404.
  const d = await getStudentDetail(enrollmentId);
  if (!d) notFound();

  return (
    <main className="flex flex-col gap-4 p-4">
      <Link
        href={`/teacher/students?cohort=${d.cohortId}`}
        className="inline-flex min-h-11 items-center gap-1 font-bold text-info-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong"
      >
        <ArrowLeft aria-hidden="true" className="size-5" />
        O&apos;quvchilar
      </Link>

      <Card>
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-2xl font-extrabold">{d.name}</h1>
            <StatusChip status={d.status} />
          </div>
          <dl className="grid gap-x-6 gap-y-1 text-sm [grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr))]">
            <div><dt className="text-ink-2">Guruh</dt><dd className="font-bold">{d.cohortName}</dd></div>
            <div><dt className="text-ink-2">Telefon</dt><dd className="font-bold">{d.phone ?? "—"}</dd></div>
            <div>
              <dt className="text-ink-2">Telegram</dt>
              <dd className="font-bold">{d.telegramLinked ? (d.telegramUsername ? `@${d.telegramUsername}` : "Ulangan") : "Ulanmagan"}</dd>
            </div>
            <div><dt className="text-ink-2">Kurator guruhi</dt><dd className="font-bold">{d.groupName ?? "—"}</dd></div>
            <div><dt className="text-ink-2">Kirish muddati</dt><dd className="font-bold">{formatInstantDay(d.expiresAt)}</dd></div>
            <div><dt className="text-ink-2">Oxirgi faollik</dt><dd className="font-bold">{formatDay(d.lastActive)}</dd></div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Chip tone="brand"><Zap aria-hidden="true" className="size-4" />{d.xp} XP</Chip>
            <Chip tone="fire"><Flame aria-hidden="true" className="size-4" />{d.streak} kun streak</Chip>
            <Chip>
              Mashqlar: {d.attemptsCorrect} / {d.attemptsTotal} to&apos;g&apos;ri
            </Chip>
          </div>
        </header>
      </Card>

      <StudentActions
        detail={d}
        handlers={{
          approve: approveStudentAction,
          reject: rejectStudentAction,
          expire: expireStudentAction,
          move: moveStudentAction,
          setExpiry: setExpiryAction,
          linkTelegram: linkTelegramAction,
        }}
      />

      <Card>
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-extrabold">Darslar bo&apos;yicha progress</h2>
          {d.lessons.length === 0 ? (
            <p className="text-ink-2">Hali e&apos;lon qilingan darslar yo&apos;q.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {d.lessons.map((l) => (
                <li key={l.lessonId} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate font-bold">{l.title}</span>
                    <span className="text-ink-2">{l.done} / {l.total}</span>
                  </div>
                  <ProgressBar value={l.done} max={l.total} label={`${l.title}: ${l.done} / ${l.total}`} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </Card>

      <Card>
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-extrabold">So&apos;nggi topshiriqlar</h2>
          {d.submissions.length === 0 ? (
            <p className="text-ink-2">Hali topshiriq yo&apos;q.</p>
          ) : (
            <ul className="flex flex-col">
              {d.submissions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 first:border-t-0">
                  <div className="min-w-0">
                    <p className="truncate font-bold">{s.prompt || "Mashq"}</p>
                    <p className="text-sm text-ink-2">{KIND[s.kind] ?? s.kind} · {formatInstantDay(s.createdAt)}</p>
                  </div>
                  {s.score !== null ? (
                    <Chip tone="ok">{s.score.toFixed(2)} / 5</Chip>
                  ) : (
                    <Chip tone="info">{s.status === "reviewed" ? "Tekshirilgan" : "Kutmoqda"}</Chip>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </Card>
    </main>
  );
}
