import "server-only";
import { createClient } from "@/lib/supabase/server";
import { tashkentDay } from "@/lib/gamification/day";
import { currentStreak } from "@/lib/gamification/streak";
import { computePathStatus, type PartProgress } from "@/lib/path-status";

export const WEEKDAY_LABELS = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"] as const;

/** Daily task targets (spec: words 10, grammar 1, audio 1, speaking 1). */
export const DAILY_TARGETS = { words: 10, grammar: 1, audio: 1, speaking: 1 } as const;
export type DailyTaskKey = keyof typeof DAILY_TARGETS;

export interface ActivityRow {
  day: string;
  xp: number;
  tasks: Record<string, unknown> | null;
}

export interface CurrentEnrollment {
  cohortId: string;
  courseId: string;
  /** Group name, else cohort name. */
  label: string;
}

export interface CurrentPart {
  partId: string;
  lessonTitle: string;
  kind: "grammar" | "conversation";
  /** 0..100 */
  percent: number;
  /** true when the student has any progress row for this part or earlier parts */
  started: boolean;
}

/**
 * Narrow data port. The production adapter below talks to Supabase (under the
 * user's JWT, so RLS stays the authority); tests inject an in-memory fake.
 */
export interface DashboardDb {
  fullName(studentId: string): Promise<string>;
  /**
   * The student's current enrollment, resolved once per request with the same rule as
   * requireStudent (active, not expired), newest approval first.
   */
  enrollment(studentId: string, nowIso: string): Promise<CurrentEnrollment | null>;
  /** Days with activity, newest first. */
  activity(studentId: string): Promise<ActivityRow[]>;
  /** Lifetime XP of the signed-in student (summed in SQL). */
  totalXp(studentId: string): Promise<number>;
  /** Row in the cohort's weekly XP leaderboard, or null if absent. */
  weeklyRank(cohortId: string, studentId: string): Promise<{ rank: number; score: number } | null>;
  currentPart(studentId: string, courseId: string): Promise<CurrentPart | null>;
  dueCards(studentId: string, nowIso: string): Promise<number>;
}

export interface WeekDay {
  label: (typeof WEEKDAY_LABELS)[number];
  day: string;
  done: boolean;
  today: boolean;
}

export interface DailyTask {
  key: DailyTaskKey;
  done: number;
  target: number;
}

export interface Dashboard {
  firstName: string;
  groupLabel: string | null;
  streak: number;
  totalXp: number;
  weeklyRank: number | null;
  week: WeekDay[];
  currentPart: CurrentPart | null;
  tasks: DailyTask[];
  dueCards: number;
  /** New student: nothing done yet. */
  isEmpty: boolean;
}

const DAY_MS = 86_400_000;
const ms = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

export function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}

/** Monday..Sunday of the week containing `today` (YYYY-MM-DD, Tashkent). */
export function buildWeek(today: string, activeDays: Set<string>): WeekDay[] {
  const dow = new Date(ms(today)).getUTCDay(); // 0 = Sunday
  const mondayOffset = (dow + 6) % 7;
  const monday = ms(today) - mondayOffset * DAY_MS;
  return WEEKDAY_LABELS.map((label, i) => {
    const day = isoDay(monday + i * DAY_MS);
    return { label, day, done: activeDays.has(day), today: day === today };
  });
}

function taskCount(tasks: ActivityRow["tasks"], key: string): number {
  const v = tasks?.[key];
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, v);
  if (v === true) return 1;
  return 0;
}

export async function getDashboardWith(
  db: DashboardDb,
  studentId: string,
  now: Date = new Date(),
): Promise<Dashboard> {
  const today = tashkentDay(now);
  const nowIso = now.toISOString();
  const enrollment = await db.enrollment(studentId, nowIso);
  const [fullName, activity, totalXp, currentPart, dueCards, rankRow] = await Promise.all([
    db.fullName(studentId),
    db.activity(studentId),
    db.totalXp(studentId),
    enrollment ? db.currentPart(studentId, enrollment.courseId) : Promise.resolve(null),
    db.dueCards(studentId, nowIso),
    enrollment ? db.weeklyRank(enrollment.cohortId, studentId) : Promise.resolve(null),
  ]);
  // A student with no XP this week is tied at rank 1 with everyone else; show no rank.
  const weeklyRank = rankRow && rankRow.score > 0 ? rankRow.rank : null;

  const activeDays = new Set(activity.filter((a) => a.xp > 0).map((a) => a.day));
  const todayRow = activity.find((a) => a.day === today);

  return {
    firstName: firstNameOf(fullName),
    groupLabel: enrollment?.label ?? null,
    streak: currentStreak([...activeDays], today),
    totalXp,
    weeklyRank,
    week: buildWeek(today, activeDays),
    currentPart,
    tasks: (Object.keys(DAILY_TARGETS) as DailyTaskKey[]).map((key) => ({
      key,
      target: DAILY_TARGETS[key],
      done: Math.min(taskCount(todayRow?.tasks ?? null, key), DAILY_TARGETS[key]),
    })),
    dueCards,
    isEmpty: activity.length === 0 && totalXp === 0 && !(currentPart?.started ?? false),
  };
}

/** Surface any PostgREST error so error.tsx renders instead of misleading zeros. */
type Row = Record<string, unknown>;
function ok<T = Row[]>(res: { data: unknown; error: { message: string } | null }, what: string): T | null {
  if (res.error) throw new Error(`dashboard: ${what}: ${res.error.message}`);
  return res.data as T | null;
}

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

type Sb = Awaited<ReturnType<typeof createClient>>;

export function supabaseDashboardDb(sb: Sb): DashboardDb {
  return {
    async fullName(studentId) {
      const data = ok<{ full_name: string }>(
        await sb.from("profiles").select("full_name").eq("id", studentId).maybeSingle(),
        "profile",
      );
      return data?.full_name ?? "";
    },

    async enrollment(studentId, nowIso) {
      const data = ok<{ cohort_id: string; cohorts: unknown; curator_groups: unknown }>(
        await sb
          .from("enrollments")
          .select("cohort_id, cohorts(name, course_id), curator_groups(name)")
          .eq("student_id", studentId)
          .eq("status", "active")
          .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
          .order("approved_at", { ascending: false, nullsFirst: false })
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle(),
        "enrollment",
      );
      if (!data) return null;
      type Cohort = { name: string; course_id: string };
      const group = one(data.curator_groups as { name: string } | { name: string }[] | null);
      const cohort = one(data.cohorts as Cohort | Cohort[] | null);
      if (!cohort) return null;
      return {
        cohortId: data.cohort_id as string,
        courseId: cohort.course_id,
        label: group?.name ?? cohort.name ?? "",
      };
    },

    async activity(studentId) {
      const data = ok(
        await sb
          .from("daily_activity")
          .select("day, xp, tasks")
          .eq("student_id", studentId)
          .order("day", { ascending: false })
          .limit(400),
        "activity",
      );
      return (data ?? []) as unknown as ActivityRow[];
    },

    async totalXp() {
      const data = ok<unknown>(await sb.rpc("my_total_xp"), "total xp");
      return Number(data ?? 0);
    },

    async weeklyRank(cohortId, studentId) {
      const data = ok<unknown>(
        await sb.rpc("leaderboard", { p_cohort: cohortId, p_kind: "xp", p_period: "week" }),
        "leaderboard",
      );
      const row = ((data ?? []) as { rank: number; student_id: string; score: number | string }[]).find(
        (r) => r.student_id === studentId,
      );
      return row ? { rank: row.rank, score: Number(row.score) } : null;
    },

    async currentPart(studentId, courseId) {
      const modules = ok(
        await sb
          .from("modules")
          .select("position, lessons(position, title, lesson_parts(id, position, kind))")
          .eq("course_id", courseId),
        "modules",
      );

      type Part = { id: string; position: number; kind: "grammar" | "conversation"; lessonTitle: string };
      const parts: (Part & { order: number })[] = [];
      for (const m of (modules ?? []) as unknown as {
        position: number;
        lessons: { position: number; title: string; lesson_parts: Omit<Part, "lessonTitle">[] }[];
      }[]) {
        for (const l of m.lessons ?? []) {
          for (const p of l.lesson_parts ?? []) {
            parts.push({
              ...p,
              lessonTitle: l.title,
              order: m.position * 1_000_000 + l.position * 10 + p.position,
            });
          }
        }
      }
      if (parts.length === 0) return null;

      const prog = ok(
        await sb.from("part_progress").select("lesson_part_id, status").eq("student_id", studentId),
        "part progress",
      );
      const progress = new Map<string, PartProgress>(
        (prog ?? []).map((r) => [r.lesson_part_id as string, r.status as PartProgress]),
      );
      const statuses = computePathStatus(parts, progress);
      const sorted = [...parts].sort((a, b) => a.order - b.order);
      const current = sorted.find((p) => statuses.get(p.id) !== "completed");
      if (!current) return null;

      const blocks = ok(
        await sb
          .from("blocks")
          .select("id")
          .eq("lesson_part_id", current.id)
          .eq("type", "exercise")
          .eq("published", true),
        "blocks",
      );
      const blockIds = (blocks ?? []).map((b) => b.id as string);
      let percent = 0;
      if (blockIds.length > 0) {
        const exs = ok(await sb.from("exercises").select("id").in("block_id", blockIds), "exercises");
        const exIds = (exs ?? []).map((e) => e.id as string);
        if (exIds.length > 0) {
          const solvedRows = ok(
            await sb
              .from("attempts")
              .select("exercise_id")
              .eq("student_id", studentId)
              .eq("is_correct", true)
              .in("exercise_id", exIds),
            "attempts",
          );
          const solved = new Set((solvedRows ?? []).map((a) => a.exercise_id as string));
          percent = Math.round((solved.size / exIds.length) * 100);
        }
      }
      return {
        partId: current.id,
        lessonTitle: current.lessonTitle,
        kind: current.kind,
        percent,
        started: progress.size > 0,
      };
    },

    async dueCards(studentId, nowIso) {
      const res = await sb
        .from("srs_cards")
        .select("word_id", { count: "exact", head: true })
        .eq("student_id", studentId)
        .lte("due_at", nowIso);
      if (res.error) throw new Error(`dashboard: due cards: ${res.error.message}`);
      return res.count ?? 0;
    },
  };
}

/** Single server entry point for the home screen. */
export async function getDashboard(studentId: string): Promise<Dashboard> {
  const sb = await createClient();
  return getDashboardWith(supabaseDashboardDb(sb), studentId);
}

/**
 * Target of the "Gapirish" tab: newest block-attached speaking exercise without a submission,
 * else /path. Failures are logged and fall back to /path (the nav must never break the page).
 */
export async function getSpeakHref(studentId: string): Promise<string> {
  try {
    const sb = await createClient();
    const exs = ok(
      await sb
        .from("exercises")
        .select("id")
        .eq("type", "speaking")
        .not("block_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(50),
      "speaking exercises",
    );
    const ids = (exs ?? []).map((e) => e.id as string);
    if (ids.length === 0) return "/path";
    const subs = ok(
      await sb.from("submissions").select("exercise_id").eq("student_id", studentId).in("exercise_id", ids),
      "submissions",
    );
    const done = new Set((subs ?? []).map((s) => s.exercise_id as string));
    const open = ids.find((id) => !done.has(id));
    return open ? `/speak/${open}` : "/path";
  } catch (err) {
    console.error("getSpeakHref failed", err instanceof Error ? err.message : "unknown error");
    return "/path";
  }
}
