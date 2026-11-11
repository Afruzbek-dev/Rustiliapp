import "server-only";
import { currentStreak } from "@/lib/gamification/streak";
import { tashkentDay } from "@/lib/gamification/day";
import { createClient } from "@/lib/supabase/server";
import { maskPhone } from "@/server/teacher-stats";

/**
 * Read side of the management area. Everything goes through the USER-scoped client, so RLS and the
 * auth.uid() checks inside the 0017 read functions decide what a teacher sees: another teacher's
 * cohort yields empty lists / "not found", never data. Submissions are read with explicit column
 * lists (the table has column-level grants; select * fails for API roles).
 */

export const PAGE_SIZE = 25;
export const STATUSES = ["active", "pending", "expired", "rejected"] as const;
export type StudentStatus = (typeof STATUSES)[number];

type Raw = Record<string, unknown>;
const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- list parameters (from the URL; untrusted) -------------------------------------------------

export interface ListParams {
  search: string;
  status: StudentStatus | null;
  groupId: string | null;
  ungrouped: boolean;
  page: number;
}

const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

export function parseListParams(sp: Record<string, string | string[] | undefined>): ListParams {
  const status = first(sp.status);
  const group = first(sp.group);
  const page = Number.parseInt(first(sp.page), 10);
  return {
    search: first(sp.q).trim().slice(0, 64),
    status: (STATUSES as readonly string[]).includes(status) ? (status as StudentStatus) : null,
    groupId: UUID.test(group) ? group : null,
    ungrouped: group === "none",
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

// --- types -------------------------------------------------------------------------------------

export interface StudentRow {
  enrollmentId: string;
  studentId: string;
  name: string;
  phone: string | null;
  telegramLinked: boolean;
  telegramUsername: string | null;
  status: StudentStatus;
  expiresAt: string | null;
  groupId: string | null;
  groupName: string | null;
  partsCompleted: number;
  partsTotal: number;
  lastActive: string | null;
  requestedAt: string;
}

export interface StatusCounts {
  total: number;
  active: number;
  pending: number;
  expired: number;
  rejected: number;
  ungrouped: number;
}

export interface StudentPage {
  rows: StudentRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: StatusCounts;
}

export interface CohortOverview {
  cohortId: string;
  courseId: string;
  courseTitle: string;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  accessUntil: string | null;
  enrollmentOpen: boolean;
  activeStudents: number;
  pendingStudents: number;
  groupCount: number;
}

export interface GroupRow {
  id: string;
  name: string;
  curatorId: string | null;
  curatorName: string | null;
  curatorTelegramLinked: boolean;
  telegramChatId: string | null;
  students: number;
  pendingQueue: number;
}

export interface CourseOption {
  id: string;
  title: string;
}

export interface LessonProgress {
  lessonId: string;
  title: string;
  done: number;
  total: number;
}

export interface RecentSubmission {
  id: string;
  kind: string;
  status: string;
  createdAt: string;
  prompt: string;
  score: number | null;
}

export interface StudentDetail {
  enrollmentId: string;
  cohortId: string;
  cohortName: string;
  studentId: string;
  name: string;
  phone: string | null;
  telegramLinked: boolean;
  telegramUsername: string | null;
  /** Needed for the manual link form: the profile has a phone but no telegram id. */
  canLinkTelegram: boolean;
  status: StudentStatus;
  expiresAt: string | null;
  groupId: string | null;
  groupName: string | null;
  xp: number;
  streak: number;
  lastActive: string | null;
  attemptsTotal: number;
  attemptsCorrect: number;
  lessons: LessonProgress[];
  submissions: RecentSubmission[];
  groups: { id: string; name: string }[];
}

// --- port --------------------------------------------------------------------------------------

export interface ManageReadDb {
  cohortsOverview(): Promise<Raw[]>;
  studentList(cohortId: string, p: ListParams, offset: number, limit: number): Promise<Raw[]>;
  counts(cohortId: string): Promise<Raw[]>;
  groups(cohortId: string): Promise<Raw[]>;
  curatorProfiles(ids: string[]): Promise<Raw[]>;
  curatorStats(cohortId: string): Promise<Raw[]>;
  courses(): Promise<Raw[]>;
  enrollment(id: string): Promise<Raw | null>;
  profile(id: string): Promise<Raw | null>;
  cohort(id: string): Promise<Raw | null>;
  studentDetail(enrollmentId: string): Promise<Raw[]>;
  courseLessons(courseId: string): Promise<{ lessons: Raw[]; parts: Raw[]; playablePartIds: string[] }>;
  partProgress(studentId: string, partIds: string[]): Promise<Raw[]>;
  recentSubmissions(studentId: string, limit: number): Promise<Raw[]>;
  exercisePrompts(ids: string[]): Promise<Raw[]>;
  latestReviewTotals(submissionIds: string[]): Promise<Raw[]>;
}

// --- assembly ----------------------------------------------------------------------------------

function toStatus(v: unknown): StudentStatus {
  return (STATUSES as readonly string[]).includes(String(v)) ? (v as StudentStatus) : "pending";
}

function toCounts(r: Raw | undefined): StatusCounts {
  return {
    total: num(r?.total),
    active: num(r?.active),
    pending: num(r?.pending),
    expired: num(r?.expired),
    rejected: num(r?.rejected),
    ungrouped: num(r?.ungrouped),
  };
}

export async function listCohortOverviewWith(db: ManageReadDb): Promise<CohortOverview[]> {
  return (await db.cohortsOverview()).map((r) => ({
    cohortId: str(r.cohort_id),
    courseId: str(r.course_id),
    courseTitle: str(r.course_title),
    name: str(r.name),
    startsOn: strOrNull(r.starts_on),
    endsOn: strOrNull(r.ends_on),
    accessUntil: strOrNull(r.access_until),
    enrollmentOpen: r.enrollment_open === true,
    activeStudents: num(r.active_students),
    pendingStudents: num(r.pending_students),
    groupCount: num(r.group_count),
  }));
}

export async function listStudentsWith(db: ManageReadDb, cohortId: string, p: ListParams): Promise<StudentPage> {
  const [rows, counts] = await Promise.all([
    db.studentList(cohortId, p, (p.page - 1) * PAGE_SIZE, PAGE_SIZE),
    db.counts(cohortId),
  ]);
  return {
    rows: rows.map((r) => ({
      enrollmentId: str(r.enrollment_id),
      studentId: str(r.student_id),
      name: str(r.full_name) || "Ismsiz o'quvchi",
      phone: maskPhone(strOrNull(r.phone)),
      telegramLinked: r.telegram_linked === true,
      telegramUsername: strOrNull(r.telegram_username),
      status: toStatus(r.status),
      expiresAt: strOrNull(r.expires_at),
      groupId: strOrNull(r.group_id),
      groupName: strOrNull(r.group_name),
      partsCompleted: num(r.parts_completed),
      partsTotal: num(r.parts_total),
      lastActive: strOrNull(r.last_active),
      requestedAt: str(r.requested_at),
    })),
    total: num(rows[0]?.total_count),
    page: p.page,
    pageSize: PAGE_SIZE,
    counts: toCounts(counts[0]),
  };
}

export async function listGroupsWith(db: ManageReadDb, cohortId: string): Promise<GroupRow[]> {
  const [groups, stats] = await Promise.all([db.groups(cohortId), db.curatorStats(cohortId)]);
  const curatorIds = [...new Set(groups.map((g) => strOrNull(g.curator_id)).filter((x): x is string => x !== null))];
  const profiles = curatorIds.length > 0 ? await db.curatorProfiles(curatorIds) : [];
  const byProfile = new Map(profiles.map((p) => [str(p.id), p]));
  const byStats = new Map(stats.map((s) => [str(s.group_id), s]));
  return groups
    .map((g) => {
      const cur = byProfile.get(str(g.curator_id));
      const st = byStats.get(str(g.id));
      return {
        id: str(g.id),
        name: str(g.name),
        curatorId: strOrNull(g.curator_id),
        curatorName: cur ? str(cur.full_name) || "Ismsiz kurator" : null,
        curatorTelegramLinked: cur?.telegram_id !== null && cur?.telegram_id !== undefined,
        telegramChatId: g.telegram_chat_id === null || g.telegram_chat_id === undefined ? null : String(g.telegram_chat_id),
        students: num(st?.students),
        pendingQueue: num(st?.pending_queue),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export async function getStudentDetailWith(
  db: ManageReadDb,
  enrollmentId: string,
  now = new Date(),
): Promise<StudentDetail | null> {
  const enr = await db.enrollment(enrollmentId);
  if (!enr) return null;
  const cohortId = str(enr.cohort_id);
  const studentId = str(enr.student_id);
  const [cohort, profile, aggregate] = await Promise.all([db.cohort(cohortId), db.profile(studentId), db.studentDetail(enrollmentId)]);
  // The aggregate function authorises like the cohort policy: no row = the viewer may not see it.
  if (!cohort || !profile || aggregate.length === 0) return null;
  const agg = aggregate[0]!;
  const groups = (await db.groups(cohortId)).map((g) => ({ id: str(g.id), name: str(g.name) }));
  const { lessons, parts, playablePartIds } = await db.courseLessons(str(cohort.course_id));
  const playable = new Set(playablePartIds);
  const playableIds = parts.map((p) => str(p.id)).filter((id) => playable.has(id));
  const progress = playableIds.length > 0 ? await db.partProgress(studentId, playableIds) : [];
  const done = new Set(progress.filter((p) => p.status === "completed").map((p) => str(p.lesson_part_id)));
  const lessonRows: LessonProgress[] = lessons
    .map((l) => {
      const own = parts.filter((p) => str(p.lesson_id) === str(l.id) && playable.has(str(p.id)));
      return {
        lessonId: str(l.id),
        title: str(l.title),
        done: own.filter((p) => done.has(str(p.id))).length,
        total: own.length,
      };
    })
    .filter((l) => l.total > 0);

  const subs = await db.recentSubmissions(studentId, 10);
  const [prompts, totals] =
    subs.length > 0
      ? await Promise.all([
          db.exercisePrompts([...new Set(subs.map((s) => str(s.exercise_id)))]),
          db.latestReviewTotals(subs.map((s) => str(s.id))),
        ])
      : [[], []];
  const promptOf = new Map(prompts.map((p) => [str(p.id), str(p.prompt)]));
  const scoreOf = new Map<string, number>();
  for (const t of totals) if (!scoreOf.has(str(t.submission_id))) scoreOf.set(str(t.submission_id), num(t.total)); // newest first

  const days = Array.isArray(agg.active_days) ? (agg.active_days as unknown[]).map(String) : [];
  const status = effectiveStatus(str(enr.status), strOrNull(enr.expires_at), now);
  const groupId = strOrNull(enr.curator_group_id);
  return {
    enrollmentId,
    cohortId,
    cohortName: str(cohort.name),
    studentId,
    name: str(profile.full_name) || "Ismsiz o'quvchi",
    phone: maskPhone(strOrNull(profile.phone)),
    telegramLinked: profile.telegram_id !== null && profile.telegram_id !== undefined,
    telegramUsername: strOrNull(profile.telegram_username),
    canLinkTelegram: (profile.telegram_id === null || profile.telegram_id === undefined) && !!strOrNull(profile.phone),
    status,
    expiresAt: strOrNull(enr.expires_at),
    groupId,
    groupName: groups.find((g) => g.id === groupId)?.name ?? null,
    xp: num(agg.xp_total),
    streak: currentStreak(days, tashkentDay(now)),
    lastActive: strOrNull(agg.last_active),
    attemptsTotal: num(agg.attempts_total),
    attemptsCorrect: num(agg.attempts_correct),
    lessons: lessonRows,
    submissions: subs.map((s) => ({
      id: str(s.id),
      kind: str(s.kind),
      status: str(s.status),
      createdAt: str(s.created_at),
      prompt: promptOf.get(str(s.exercise_id)) ?? "",
      score: scoreOf.get(str(s.id)) ?? null,
    })),
    groups,
  };
}

export function effectiveStatus(status: string, expiresAt: string | null, now: Date): StudentStatus {
  if (status === "active" && expiresAt !== null && new Date(expiresAt).getTime() <= now.getTime()) return "expired";
  return toStatus(status);
}

// --- Supabase adapter (user-scoped client) -------------------------------------------------------

type UserClient = Awaited<ReturnType<typeof createClient>>;

export function supabaseReadDb(sb: UserClient): ManageReadDb {
  const fail = (op: string, error: { code?: string } | null): never => {
    throw new Error(`manage read: ${op} failed (${error?.code ?? "unknown"})`);
  };
  async function rows(op: string, q: PromiseLike<{ data: unknown; error: { code?: string } | null }>): Promise<Raw[]> {
    const { data, error } = await q;
    if (error) fail(op, error);
    return (data ?? []) as Raw[];
  }
  return {
    cohortsOverview: () => rows("cohortsOverview", sb.rpc("manage_cohorts_overview")),
    studentList: (cohortId, p, offset, limit) =>
      rows(
        "studentList",
        sb.rpc("manage_student_list", {
          p_cohort: cohortId,
          p_search: p.search || null,
          p_status: p.status,
          p_group: p.groupId,
          p_ungrouped: p.ungrouped,
          p_limit: limit,
          p_offset: offset,
        }),
      ),
    counts: (cohortId) => rows("counts", sb.rpc("manage_cohort_counts", { p_cohort: cohortId })),
    groups: (cohortId) =>
      rows("groups", sb.from("curator_groups").select("id, name, curator_id, telegram_chat_id").eq("cohort_id", cohortId)),
    curatorProfiles: (ids) => rows("curatorProfiles", sb.from("profiles").select("id, full_name, telegram_id").in("id", ids)),
    curatorStats: (cohortId) => rows("curatorStats", sb.rpc("curator_stats", { p_cohort: cohortId })),
    courses: () => rows("courses", sb.from("courses").select("id, title").order("title")),
    async enrollment(id) {
      const r = await rows(
        "enrollment",
        sb.from("enrollments").select("id, student_id, cohort_id, curator_group_id, status, expires_at").eq("id", id).limit(1),
      );
      return r[0] ?? null;
    },
    async profile(id) {
      const r = await rows("profile", sb.from("profiles").select("id, full_name, phone, telegram_id, telegram_username").eq("id", id).limit(1));
      return r[0] ?? null;
    },
    async cohort(id) {
      const r = await rows("cohort", sb.from("cohorts").select("id, course_id, name").eq("id", id).limit(1));
      return r[0] ?? null;
    },
    studentDetail: (enrollmentId) => rows("studentDetail", sb.rpc("manage_student_detail", { p_enrollment: enrollmentId })),
    async courseLessons(courseId) {
      const modules = await rows("modules", sb.from("modules").select("id, position").eq("course_id", courseId));
      const moduleIds = modules.map((m) => str(m.id));
      if (moduleIds.length === 0) return { lessons: [], parts: [], playablePartIds: [] };
      const pos = new Map(modules.map((m) => [str(m.id), num(m.position)]));
      const lessonRows = await rows("lessons", sb.from("lessons").select("id, module_id, position, title").in("module_id", moduleIds));
      lessonRows.sort((a, b) => (pos.get(str(a.module_id)) ?? 0) - (pos.get(str(b.module_id)) ?? 0) || num(a.position) - num(b.position));
      const lessonIds = lessonRows.map((l) => str(l.id));
      const parts = lessonIds.length > 0 ? await rows("parts", sb.from("lesson_parts").select("id, lesson_id").in("lesson_id", lessonIds)) : [];
      const partIds = parts.map((p) => str(p.id));
      let playable: string[] = [];
      if (partIds.length > 0) {
        const { data, error } = await sb.rpc("published_part_ids", { p_part_ids: partIds });
        if (error) fail("playable", error);
        playable = ((data ?? []) as unknown[]).map(String);
      }
      return { lessons: lessonRows, parts, playablePartIds: playable };
    },
    partProgress: (studentId, partIds) =>
      rows("partProgress", sb.from("part_progress").select("lesson_part_id, status").eq("student_id", studentId).in("lesson_part_id", partIds)),
    recentSubmissions: (studentId, limit) =>
      rows(
        "recentSubmissions",
        sb
          .from("submissions")
          .select("id, exercise_id, kind, status, created_at")
          .eq("student_id", studentId)
          .order("created_at", { ascending: false })
          .limit(limit),
      ),
    exercisePrompts: (ids) => rows("exercisePrompts", sb.from("exercises").select("id, prompt").in("id", ids)),
    latestReviewTotals: (ids) =>
      rows("reviews", sb.from("reviews").select("submission_id, total, created_at").in("submission_id", ids).order("created_at", { ascending: false })),
  };
}

export async function listCohortOverview(): Promise<CohortOverview[]> {
  return listCohortOverviewWith(supabaseReadDb(await createClient()));
}

export async function listStudents(cohortId: string, p: ListParams): Promise<StudentPage> {
  return listStudentsWith(supabaseReadDb(await createClient()), cohortId, p);
}

export async function listGroups(cohortId: string): Promise<GroupRow[]> {
  return listGroupsWith(supabaseReadDb(await createClient()), cohortId);
}

export async function getCohortCounts(cohortId: string): Promise<StatusCounts> {
  return toCounts((await supabaseReadDb(await createClient()).counts(cohortId))[0]);
}

export async function listCourses(): Promise<CourseOption[]> {
  const rows = await supabaseReadDb(await createClient()).courses();
  return rows.map((r) => ({ id: str(r.id), title: str(r.title) }));
}

export async function getStudentDetail(enrollmentId: string): Promise<StudentDetail | null> {
  if (!UUID.test(enrollmentId)) return null;
  return getStudentDetailWith(supabaseReadDb(await createClient()), enrollmentId);
}
