import Link from "next/link";
import { CalendarPlus, GraduationCap } from "lucide-react";
import { Card, Chip, EmptyState } from "@/components/ui";
import { TextField } from "../editor/fields";
import type { StaffAction } from "../action-state";
import { ActionForm, selectClass } from "./ActionForm";
import { CopyField } from "./CopyField";
import { formatDay, formatInstantDay } from "./status";
import type { CohortOverview, CourseOption } from "@/server/manage-read";

export interface CohortHandlers {
  create: StaffAction;
  update: StaffAction;
  setAccess: StaffAction;
}

export interface ShareLinks {
  /** Deep link to the bot (https://t.me/<bot>) or null when it is not configured. */
  bot: string | null;
  /** The site's login page. */
  site: string | null;
}

/** `YYYY-MM-DD` of the Tashkent day `days` from `now` (default for the "open until" picker). */
function tashkentPlus(days: number, now: Date): string {
  return new Date(now.getTime() + 5 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);
}

function CohortFields({ cohort, withAccess }: { cohort?: CohortOverview; withAccess: boolean }) {
  return (
    <>
      <TextField label="Nomi" name="name" required maxLength={80} defaultValue={cohort?.name ?? ""} />
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr))]">
        <TextField label="Boshlanishi" name="startsOn" type="date" defaultValue={cohort?.startsOn ?? ""} />
        <TextField label="Tugashi" name="endsOn" type="date" defaultValue={cohort?.endsOn ?? ""} />
        {withAccess && (
          <TextField label="Kirish muddati" name="accessUntil" type="date" hint="Bo'sh bo'lsa: tugash sanasidan 1 oy keyin." />
        )}
      </div>
    </>
  );
}

function CohortCard({ cohort, handlers, links, now }: { cohort: CohortOverview; handlers: CohortHandlers; links: ShareLinks; now: Date }) {
  const open = cohort.enrollmentOpen;
  const sid = `/teacher/students?cohort=${cohort.cohortId}`;
  return (
    <Card>
      <article className="flex flex-col gap-3" aria-label={cohort.name}>
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold">{cohort.name}</h2>
            <p className="text-sm text-ink-2">
              {cohort.courseTitle} · {formatDay(cohort.startsOn)} – {formatDay(cohort.endsOn)}
            </p>
          </div>
          <Chip tone={open ? "ok" : "fire"}>{open ? "Qabul ochiq" : "Qabul yopiq"}</Chip>
        </header>

        <p className="text-sm text-ink">
          Faol: <b>{cohort.activeStudents}</b> · Kutmoqda: <b>{cohort.pendingStudents}</b> · Guruhlar: <b>{cohort.groupCount}</b>
          {cohort.accessUntil && <span className="text-ink-2"> · Kirish: {formatInstantDay(cohort.accessUntil)} gacha</span>}
        </p>

        <nav aria-label={`${cohort.name} bo'limlari`} className="flex flex-wrap gap-2">
          <Link
            href={sid}
            className="inline-flex min-h-11 items-center rounded-full border-2 border-border-strong px-4 text-sm font-bold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong"
          >
            O&apos;quvchilar
          </Link>
          <Link
            href={`/teacher/curators?cohort=${cohort.cohortId}`}
            className="inline-flex min-h-11 items-center rounded-full border-2 border-border-strong px-4 text-sm font-bold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong"
          >
            Kurator guruhlari
          </Link>
        </nav>

        {open ? (
          <ActionForm action={handlers.setAccess} submitLabel="Qabulni yopish">
            <input type="hidden" name="cohortId" value={cohort.cohortId} />
            <input type="hidden" name="open" value="false" />
          </ActionForm>
        ) : (
          <ActionForm action={handlers.setAccess} submitLabel="Qabulni ochish" variant="success" inline>
            <input type="hidden" name="cohortId" value={cohort.cohortId} />
            <input type="hidden" name="open" value="true" />
            <TextField label="Qabul ochiq: sanagacha" name="until" type="date" required min={tashkentPlus(1, now)} defaultValue={tashkentPlus(30, now)} />
          </ActionForm>
        )}

        <details className="rounded-[var(--radius-md)] border-2 border-border p-3">
          <summary className="flex min-h-11 cursor-pointer items-center font-bold">Tahrirlash</summary>
          <div className="mt-2">
            <ActionForm action={handlers.update} submitLabel="Saqlash" variant="primary">
              <input type="hidden" name="cohortId" value={cohort.cohortId} />
              <CohortFields cohort={cohort} withAccess={false} />
            </ActionForm>
          </div>
        </details>

        <details className="rounded-[var(--radius-md)] border-2 border-border p-3">
          <summary className="flex min-h-11 cursor-pointer items-center font-bold">Taklif havolasi</summary>
          <div className="mt-2 flex flex-col gap-3">
            <p className="text-sm text-ink-2">
              O&apos;quvchi botga kiradi va telefonini ulashadi; so&apos;rov eng so&apos;nggi ochiq guruhga tushadi
              {open ? "." : ", lekin bu guruh hozir yopiq."} Havola matnini QR-generatorga qo&apos;yib, QR kod yasash mumkin.
            </p>
            {links.bot && <CopyField label="Telegram bot havolasi" value={links.bot} />}
            {links.site && <CopyField label="Kirish sahifasi" value={links.site} />}
            {!links.bot && !links.site && <p className="text-sm text-fire-text">Havola sozlanmagan (APP_URL, TELEGRAM_BOT_USERNAME).</p>}
          </div>
        </details>
      </article>
    </Card>
  );
}

export interface CohortsPanelProps {
  cohorts: CohortOverview[];
  courses: CourseOption[];
  handlers: CohortHandlers;
  links: ShareLinks;
  now?: Date;
}

export function CohortsPanel({ cohorts, courses, handlers, links, now = new Date() }: CohortsPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <section className="flex flex-col gap-3" aria-labelledby="new-cohort">
          <h2 id="new-cohort" className="flex items-center gap-2 text-lg font-extrabold">
            <CalendarPlus aria-hidden="true" className="size-5" />
            Yangi guruh
          </h2>
          {courses.length === 0 ? (
            <p className="text-ink-2">Guruh yaratish uchun avval kurs kerak.</p>
          ) : (
            <ActionForm action={handlers.create} submitLabel="Yaratish" variant="primary">
              {courses.length === 1 ? (
                <input type="hidden" name="courseId" value={courses[0]!.id} />
              ) : (
                <label className="flex flex-col gap-1 text-sm font-bold text-ink-2">
                  Kurs
                  <select name="courseId" required className={selectClass}>
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <CohortFields withAccess />
            </ActionForm>
          )}
        </section>
      </Card>

      {cohorts.length === 0 ? (
        <EmptyState icon={<GraduationCap className="size-10" />} title="Hali guruh yo'q" text="Birinchi guruhni yuqoridagi shakldan yarating." />
      ) : (
        <ul className="flex flex-col gap-4">
          {cohorts.map((c) => (
            <li key={c.cohortId}>
              <CohortCard cohort={c} handlers={handlers} links={links} now={now} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
