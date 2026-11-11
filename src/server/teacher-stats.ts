import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Teacher dashboard data. Statistics come from the 0015 SQL functions, called through the
 * USER-scoped client so that auth.uid() inside them is the teacher (they return nothing to
 * anyone who does not teach the cohort). Enrollment/cohort lists are read through RLS.
 * Every query throws on error (the route's error.tsx renders it).
 */

export interface CohortOption {
  id: string;
  name: string;
  startsOn: string | null;
}

export interface Kpis {
  activeStudents: number;
  totalStudents: number;
  pendingRequests: number;
  activeToday: number;
  unreviewedSubmissions: number;
  avgProgress: number;
}

export interface ActivityDay {
  day: string;
  active: number;
}

export interface LessonCompletionRow {
  lessonId: string;
  title: string;
  completed: number;
  total: number;
}

export interface CuratorRow {
  groupId: string;
  groupName: string;
  curatorName: string;
  students: number;
  pendingQueue: number;
  avgScore: number | null;
  avgResponseHours: number | null;
}

export interface IdleStudent {
  studentId: string;
  name: string;
  telegramLinked: boolean;
  lastActive: string | null;
  lastPartTitle: string | null;
}

export interface PendingRequest {
  enrollmentId: string;
  studentName: string;
  /** Masked: never the full number. */
  phone: string | null;
  requestedAt: string;
}

export interface TeacherDashboard {
  kpis: Kpis;
  activity: ActivityDay[];
  lessons: LessonCompletionRow[];
  curators: CuratorRow[];
  idle: IdleStudent[];
  requests: PendingRequest[];
}

type Raw = Record<string, unknown>;

/** Narrow data port; the production adapter below uses the user-scoped Supabase client. */
export interface StatsDb {
  cohorts(): Promise<Raw[]>;
  rpc(fn: "teacher_kpis" | "daily_active" | "lesson_completion" | "curator_stats" | "idle_students", cohortId: string): Promise<Raw[]>;
  pendingEnrollments(cohortId: string): Promise<Raw[]>;
  profiles(ids: string[]): Promise<Raw[]>;
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : num(v));
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** "+998901234567" -> "+998 ** *** ** 67". */
export function maskPhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 7) return phone ? "***" : null;
  return `+${digits.slice(0, 3)} ** *** ** ${digits.slice(-2)}`;
}

/** Newest first: latest start date (undated last), then latest creation. */
export function sortCohorts(rows: Raw[]): CohortOption[] {
  return [...rows]
    .sort(
      (a, b) =>
        str(b.starts_on).localeCompare(str(a.starts_on)) ||
        str(b.created_at).localeCompare(str(a.created_at)) ||
        str(a.id).localeCompare(str(b.id)),
    )
    .map((r) => ({ id: str(r.id), name: str(r.name), startsOn: strOrNull(r.starts_on) }));
}

/** The cohort named by `?cohort=` if the teacher may see it, else the newest one. */
export function pickCohort(options: CohortOption[], requested: unknown): CohortOption | null {
  if (typeof requested === "string") {
    const found = options.find((o) => o.id === requested);
    if (found) return found;
  }
  return options[0] ?? null;
}

export async function listCohortsWith(db: StatsDb): Promise<CohortOption[]> {
  return sortCohorts(await db.cohorts());
}

export async function getDashboardWith(db: StatsDb, cohortId: string): Promise<TeacherDashboard> {
  const [kpiRows, daily, lessons, curators, idle, enrollments] = await Promise.all([
    db.rpc("teacher_kpis", cohortId),
    db.rpc("daily_active", cohortId),
    db.rpc("lesson_completion", cohortId),
    db.rpc("curator_stats", cohortId),
    db.rpc("idle_students", cohortId),
    db.pendingEnrollments(cohortId),
  ]);
  const k = kpiRows[0] ?? {};
  const studentIds = [...new Set(enrollments.map((e) => str(e.student_id)))];
  const profiles = studentIds.length > 0 ? await db.profiles(studentIds) : [];
  const byId = new Map(profiles.map((p) => [str(p.id), p]));

  return {
    kpis: {
      activeStudents: num(k.active_students),
      totalStudents: num(k.total_students),
      pendingRequests: num(k.pending_requests),
      activeToday: num(k.active_today),
      unreviewedSubmissions: num(k.unreviewed_submissions),
      avgProgress: num(k.avg_progress),
    },
    activity: daily.map((r) => ({ day: str(r.day), active: num(r.active) })),
    lessons: lessons.map((r) => ({
      lessonId: str(r.lesson_id),
      title: str(r.title),
      completed: num(r.completed_students),
      total: num(r.total_active_students),
    })),
    curators: curators.map((r) => ({
      groupId: str(r.group_id),
      groupName: str(r.group_name),
      curatorName: str(r.curator_name),
      students: num(r.students),
      pendingQueue: num(r.pending_queue),
      avgScore: numOrNull(r.avg_score),
      avgResponseHours: numOrNull(r.avg_response_hours),
    })),
    idle: idle.map((r) => ({
      studentId: str(r.student_id),
      name: str(r.full_name),
      telegramLinked: r.telegram_linked === true,
      lastActive: strOrNull(r.last_active),
      lastPartTitle: strOrNull(r.last_part_title),
    })),
    requests: enrollments.map((e) => {
      const p = byId.get(str(e.student_id));
      return {
        enrollmentId: str(e.id),
        studentName: str(p?.full_name) || "Ismsiz o'quvchi",
        phone: maskPhone(strOrNull(p?.phone)),
        requestedAt: str(e.created_at),
      };
    }),
  };
}

type UserClient = Awaited<ReturnType<typeof createClient>>;

export function supabaseStatsDb(sb: UserClient): StatsDb {
  const fail = (op: string, error: { code?: string }): never => {
    throw new Error(`teacher stats: ${op} failed (${error.code ?? "unknown"})`);
  };
  return {
    async cohorts() {
      const { data, error } = await sb.from("cohorts").select("id, name, starts_on, created_at");
      if (error) fail("cohorts", error);
      return (data ?? []) as Raw[];
    },
    async rpc(fn, cohortId) {
      const { data, error } = await sb.rpc(fn, { p_cohort: cohortId });
      if (error) fail(fn, error);
      return (data ?? []) as Raw[];
    },
    async pendingEnrollments(cohortId) {
      const { data, error } = await sb
        .from("enrollments")
        .select("id, student_id, created_at")
        .eq("cohort_id", cohortId)
        .eq("status", "pending")
        .order("created_at", { ascending: true });
      if (error) fail("pendingEnrollments", error);
      return (data ?? []) as Raw[];
    },
    async profiles(ids) {
      const { data, error } = await sb.from("profiles").select("id, full_name, phone").in("id", ids);
      if (error) fail("profiles", error);
      return (data ?? []) as Raw[];
    },
  };
}

export async function listCohorts(): Promise<CohortOption[]> {
  return listCohortsWith(supabaseStatsDb(await createClient()));
}

export async function getTeacherDashboard(cohortId: string): Promise<TeacherDashboard> {
  return getDashboardWith(supabaseStatsDb(await createClient()), cohortId);
}
