"use client";

import { useActionState } from "react";
import { BellRing, PartyPopper } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";
import { IDLE, type StaffAction } from "./action-state";

export interface IdleItem {
  studentId: string;
  name: string;
  telegramLinked: boolean;
  /** YYYY-MM-DD or null when never active. */
  lastActive: string | null;
  lastPartTitle: string | null;
  remindedToday: boolean;
}

export interface IdleStudentsProps {
  students: IdleItem[];
  cohortId: string;
  /** Today's Tashkent day (YYYY-MM-DD), passed in so rendering stays pure. */
  today: string;
  remindAction: StaffAction;
}

export function daysSince(today: string, day: string): number {
  return Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000));
}

function IdleRow({ student, cohortId, today, remindAction }: { student: IdleItem; cohortId: string; today: string; remindAction: StaffAction }) {
  const [state, formAction, pending] = useActionState(remindAction, IDLE);
  const sent = student.remindedToday || state.status === "success" || state.status === "info";
  const disabled = !student.telegramLinked || sent;
  const since = student.lastActive === null ? "Hali faol bo'lmagan" : `${daysSince(today, student.lastActive)} kun oldin faol bo'lgan`;
  const msg = state.status !== "idle" ? state : null;

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3 first:border-t-0">
      <div className="min-w-0">
        <p className="truncate font-bold text-ink">{student.name}</p>
        <p className="text-sm text-ink-2">
          {since}
          {student.lastPartTitle ? ` · ${student.lastPartTitle}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!student.telegramLinked && <span className="text-sm text-ink-2">Telegram ulanmagan</span>}
        {msg && (
          <p role="status" className={`text-sm font-bold ${msg.status === "error" ? "text-fire-text" : msg.status === "success" ? "text-ok-text" : "text-ink-2"}`}>
            {msg.message}
          </p>
        )}
        {student.remindedToday && !msg && <span className="text-sm text-ink-2">Bugun yuborilgan</span>}
        <form action={formAction}>
          <input type="hidden" name="studentId" value={student.studentId} />
          <input type="hidden" name="cohortId" value={cohortId} />
          <Button type="submit" variant="secondary" loading={pending} disabled={disabled} aria-label={`${student.name}ga eslatma yuborish`}>
            <BellRing aria-hidden="true" className="size-5" />
            Eslatma
          </Button>
        </form>
      </div>
    </li>
  );
}

export function IdleStudents({ students, cohortId, today, remindAction }: IdleStudentsProps) {
  if (students.length === 0) {
    return <EmptyState icon={<PartyPopper className="size-8" />} title="Hamma faol" text="Oxirgi kunlarda mashqdan chetda qolgan o'quvchi yo'q." />;
  }
  return (
    <ul className="flex flex-col">
      {students.map((s) => (
        <IdleRow key={s.studentId} student={s} cohortId={cohortId} today={today} remindAction={remindAction} />
      ))}
    </ul>
  );
}
