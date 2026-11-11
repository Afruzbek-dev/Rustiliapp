import "server-only";
import type { createServiceClient } from "@/lib/supabase/service";

/**
 * Course access: a student who finished the Telegram contact step gets a `pending` enrollment;
 * staff (the course's teacher or an admin) approve or reject it, from the staff chat in Telegram
 * or, later, from the teacher dashboard.
 *
 * Calling from a server action (teacher dashboard, Task 25):
 *
 *   const res = await approveEnrollment(createServiceClient(), enrollmentId, session.profileId, {
 *     curatorGroupId, // optional; omitted -> the cohort's least loaded group
 *   });
 *   // res.outcome: "approved" | "already_approved" | "cohort_closed" (nothing changed); res.groupName / res.noGroup for the UI;
 *   // throws EnrollmentError with code "forbidden" | "not_found" | "invalid_group" | "db".
 *
 * `actorProfileId` MUST come from the verified session (or the Telegram id -> profile lookup),
 * never from a request body or callback payload: authorization happens in here.
 */
export type ServiceClient = ReturnType<typeof createServiceClient>;

export type EnrollmentStatus = "pending" | "active" | "rejected" | "expired";

export type EnrollmentRow = {
  id: string;
  student_id: string;
  cohort_id: string;
  curator_group_id: string | null;
  status: EnrollmentStatus;
  source: "manual" | "payme" | "click";
  approved_by: string | null;
  approved_at: string | null;
  expires_at: string | null;
};

const COLUMNS = "id, student_id, cohort_id, curator_group_id, status, source, approved_by, approved_at, expires_at";

export type EnrollmentErrorCode = "forbidden" | "not_found" | "invalid_group" | "db";

/** Typed failure. Carries only a code and the operation: never row data. */
export class EnrollmentError extends Error {
  constructor(
    public readonly code: EnrollmentErrorCode,
    public readonly op: string,
    public readonly dbCode?: string,
  ) {
    super(`enrollment error in ${op} (${code}${dbCode ? `:${dbCode}` : ""})`);
    this.name = "EnrollmentError";
  }
}

type DbErrorLike = { code?: string } | null;

function dbFail(op: string, error: DbErrorLike): never {
  throw new EnrollmentError("db", op, error?.code ?? "unknown");
}

type CohortRow = {
  id: string;
  course_id: string;
  starts_on: string | null;
  ends_on: string | null;
  access_until: string | null;
  created_at: string;
};
const COHORT_COLUMNS = "id, course_id, starts_on, ends_on, access_until, created_at";

async function enrollmentIn(db: ServiceClient, studentId: string, cohortId: string): Promise<EnrollmentRow | null> {
  const { data, error } = await db
    .from("enrollments")
    .select(COLUMNS)
    .eq("student_id", studentId)
    .eq("cohort_id", cohortId)
    .maybeSingle();
  if (error) dbFail("enrollmentIn", error);
  return (data as EnrollmentRow | null) ?? null;
}

export type EnsurePendingResult =
  | { created: true; enrollment: EnrollmentRow }
  | { created: false; reason: "no_cohort" }
  | { created: false; reason: "exists" | "already_enrolled"; enrollment: EnrollmentRow };

/**
 * Target cohort = the newest cohort whose `access_until` is null or in the future
 * (latest `starts_on`, then latest `created_at`). Idempotent: any existing enrollment in that
 * cohort (even rejected/active) is left untouched, and a student who already has a live
 * (pending, or active and unexpired) enrollment elsewhere gets no second request.
 */
export async function ensurePendingEnrollment(
  db: ServiceClient,
  profileId: string,
  now = new Date(),
): Promise<EnsurePendingResult> {
  const { data, error } = await db.from("cohorts").select(COHORT_COLUMNS);
  if (error) dbFail("listCohorts", error);
  const open = ((data as CohortRow[] | null) ?? [])
    .filter((c) => isCohortOpen(c, now))
    .sort(
      (a, b) =>
        (b.starts_on ?? "").localeCompare(a.starts_on ?? "") ||
        b.created_at.localeCompare(a.created_at) ||
        a.id.localeCompare(b.id),
    );
  const target = open[0];
  if (!target) return { created: false, reason: "no_cohort" };

  const existing = await enrollmentIn(db, profileId, target.id);
  if (existing) return { created: false, reason: "exists", enrollment: existing };

  const { data: mine, error: mineError } = await db.from("enrollments").select(COLUMNS).eq("student_id", profileId);
  if (mineError) dbFail("listOwnEnrollments", mineError);
  const live = ((mine as EnrollmentRow[] | null) ?? []).find(
    (e) =>
      e.status === "pending" ||
      (e.status === "active" && (e.expires_at === null || new Date(e.expires_at).getTime() > now.getTime())),
  );
  if (live) return { created: false, reason: "already_enrolled", enrollment: live };

  const { data: inserted, error: insertError } = await db
    .from("enrollments")
    .insert({ student_id: profileId, cohort_id: target.id, status: "pending", source: "manual" })
    .select(COLUMNS);
  if (insertError) {
    if (insertError.code === "23505") {
      // Lost a race with a concurrent request (e.g. a duplicate Telegram delivery).
      const winner = await enrollmentIn(db, profileId, target.id);
      if (winner) return { created: false, reason: "exists", enrollment: winner };
    }
    dbFail("insertPending", insertError);
  }
  const row = ((inserted as EnrollmentRow[] | null) ?? [])[0];
  if (!row) dbFail("insertPending", { code: "no_row" });

  // The cohort may have closed between the read and the insert: re-check and roll the row back,
  // so no staff message is sent for a request that can no longer be approved.
  const { data: fresh, error: freshError } = await db
    .from("cohorts")
    .select(COHORT_COLUMNS)
    .eq("id", target.id)
    .maybeSingle();
  if (freshError) dbFail("recheckCohort", freshError);
  if (!fresh || !isCohortOpen(fresh as CohortRow, now)) {
    const { error: undoError } = await db.from("enrollments").delete().eq("id", row.id).eq("status", "pending");
    if (undoError) dbFail("rollbackPending", undoError);
    return { created: false, reason: "no_cohort" };
  }
  return { created: true, enrollment: row };
}

type Context = {
  enrollment: EnrollmentRow;
  cohort: CohortRow;
  studentName: string;
  studentTelegramId: number | null;
};

async function loadContext(db: ServiceClient, enrollmentId: string, actorProfileId: string): Promise<Context> {
  const { data: actor, error: actorError } = await db
    .from("profiles")
    .select("id, role")
    .eq("id", actorProfileId)
    .maybeSingle();
  if (actorError) dbFail("loadActor", actorError);
  const actorRow = actor as { id: string; role: string } | null;
  if (!actorRow || (actorRow.role !== "admin" && actorRow.role !== "teacher")) {
    throw new EnrollmentError("forbidden", "authorize");
  }

  const { data: enr, error } = await db.from("enrollments").select(COLUMNS).eq("id", enrollmentId).maybeSingle();
  if (error) dbFail("loadEnrollment", error);
  const enrollment = enr as EnrollmentRow | null;
  if (!enrollment) throw new EnrollmentError("not_found", "loadEnrollment");

  const { data: cohortData, error: cohortError } = await db
    .from("cohorts")
    .select(COHORT_COLUMNS)
    .eq("id", enrollment.cohort_id)
    .maybeSingle();
  if (cohortError) dbFail("loadCohort", cohortError);
  const cohort = cohortData as CohortRow | null;
  if (!cohort) throw new EnrollmentError("not_found", "loadCohort");

  if (actorRow.role !== "admin") {
    const { data: course, error: courseError } = await db
      .from("courses")
      .select("id, teacher_id")
      .eq("id", cohort.course_id)
      .maybeSingle();
    if (courseError) dbFail("loadCourse", courseError);
    if ((course as { teacher_id: string } | null)?.teacher_id !== actorProfileId) {
      throw new EnrollmentError("forbidden", "authorize");
    }
  }

  const { data: student, error: studentError } = await db
    .from("profiles")
    .select("full_name, telegram_id")
    .eq("id", enrollment.student_id)
    .maybeSingle();
  if (studentError) dbFail("loadStudent", studentError);
  const s = student as { full_name: string; telegram_id: number | null } | null;
  return { enrollment, cohort, studentName: s?.full_name ?? "", studentTelegramId: s?.telegram_id ?? null };
}

/** A cohort still grants access when its computed expiry (see computeExpiresAt) is in the future. */
function isCohortOpen(c: Pick<CohortRow, "access_until" | "ends_on">, now: Date): boolean {
  return new Date(computeExpiresAt(c, now)).getTime() > now.getTime();
}

/** Adds one calendar month to a `YYYY-MM-DD` date (clamped to the month end), at UTC midnight (= 05:00 Asia/Tashkent). */
function plusOneMonth(date: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, lastDay)));
}

/**
 * Expiry rule for an approved enrollment. It is ALWAYS a real timestamp, because a NULL
 * `expires_at` means "never expires" in the RLS helpers and must never be produced here:
 *   1. cohort.access_until, else
 *   2. cohort.ends_on + 1 month, computed at UTC midnight (05:00 Asia/Tashkent), else
 *   3. now + 90 days.
 */
export function computeExpiresAt(cohort: Pick<CohortRow, "access_until" | "ends_on">, now = new Date()): string {
  if (cohort.access_until) return new Date(cohort.access_until).toISOString();
  if (cohort.ends_on) return plusOneMonth(cohort.ends_on).toISOString();
  return new Date(now.getTime() + 90 * 24 * 3600 * 1000).toISOString();
}

type GroupRow = { id: string; name: string };

async function pickGroup(
  db: ServiceClient,
  cohortId: string,
  explicit: string | undefined,
  now: Date,
): Promise<GroupRow | null> {
  const { data, error } = await db.from("curator_groups").select("id, name").eq("cohort_id", cohortId);
  if (error) dbFail("listGroups", error);
  const groups = (data as GroupRow[] | null) ?? [];
  if (explicit !== undefined) {
    const found = groups.find((g) => g.id === explicit);
    if (!found) throw new EnrollmentError("invalid_group", "pickGroup");
    return found;
  }
  if (groups.length === 0) return null;
  const { data: rows, error: countError } = await db
    .from("enrollments")
    .select("curator_group_id, status, expires_at")
    .eq("cohort_id", cohortId)
    .eq("status", "active");
  if (countError) dbFail("countGroupLoad", countError);
  const load = new Map<string, number>();
  for (const r of (rows as { curator_group_id: string | null; expires_at: string | null }[] | null) ?? []) {
    if (!r.curator_group_id) continue;
    if (r.expires_at !== null && new Date(r.expires_at).getTime() <= now.getTime()) continue;
    load.set(r.curator_group_id, (load.get(r.curator_group_id) ?? 0) + 1);
  }
  return [...groups].sort(
    (a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  )[0]!;
}

export type ApproveResult = {
  /** "cohort_closed": the computed expiry is not in the future; nothing was changed. */
  outcome: "approved" | "already_approved" | "cohort_closed";
  enrollment: EnrollmentRow;
  studentName: string;
  studentTelegramId: number | null;
  groupName: string | null;
  /** Name of the profile that approved it (for "already_approved"; null otherwise/unknown). */
  approvedByName: string | null;
  /** True when no curator group is assigned (the cohort has none). */
  noGroup: boolean;
};

async function groupNameOf(db: ServiceClient, id: string | null): Promise<string | null> {
  if (!id) return null;
  const { data, error } = await db.from("curator_groups").select("id, name").eq("id", id).maybeSingle();
  if (error) dbFail("loadGroup", error);
  return (data as GroupRow | null)?.name ?? null;
}

async function profileNameOf(db: ServiceClient, id: string | null): Promise<string | null> {
  if (!id) return null;
  const { data, error } = await db.from("profiles").select("id, full_name").eq("id", id).maybeSingle();
  if (error) dbFail("loadApprover", error);
  return (data as { full_name: string } | null)?.full_name ?? null;
}

/**
 * Approves an enrollment. The actor must be an admin or the teacher of the enrollment's course.
 * Idempotent: an already active enrollment is returned unchanged ("already_approved").
 * Pending, rejected and expired enrollments can be (re)approved.
 */
export async function approveEnrollment(
  db: ServiceClient,
  enrollmentId: string,
  actorProfileId: string,
  opts: { curatorGroupId?: string } = {},
  now = new Date(),
): Promise<ApproveResult> {
  const ctx = await loadContext(db, enrollmentId, actorProfileId);
  const base = { studentName: ctx.studentName, studentTelegramId: ctx.studentTelegramId };
  const unchanged = async (e: EnrollmentRow): Promise<ApproveResult> => ({
    ...base,
    outcome: "already_approved",
    enrollment: e,
    groupName: await groupNameOf(db, e.curator_group_id),
    approvedByName: await profileNameOf(db, e.approved_by),
    noGroup: e.curator_group_id === null,
  });
  if (ctx.enrollment.status === "active") return unchanged(ctx.enrollment);

  const expiresAt = computeExpiresAt(ctx.cohort, now);
  if (new Date(expiresAt).getTime() <= now.getTime()) {
    // Never activate an enrollment that is born expired (no false "access granted").
    return { ...base, outcome: "cohort_closed", enrollment: ctx.enrollment, groupName: null, approvedByName: null, noGroup: false };
  }

  const group = await pickGroup(db, ctx.cohort.id, opts.curatorGroupId, now);
  const { data, error } = await db
    .from("enrollments")
    .update({
      status: "active",
      approved_by: actorProfileId,
      approved_at: now.toISOString(),
      expires_at: expiresAt,
      curator_group_id: group?.id ?? null,
    })
    .eq("id", enrollmentId)
    .neq("status", "active")
    .select(COLUMNS);
  if (error) dbFail("approve", error);
  const updated = ((data as EnrollmentRow[] | null) ?? [])[0];
  if (!updated) {
    // A concurrent approval won the race: report its result unchanged.
    return unchanged((await loadContext(db, enrollmentId, actorProfileId)).enrollment);
  }
  return { ...base, outcome: "approved", enrollment: updated, groupName: group?.name ?? null, approvedByName: null, noGroup: group === null };
}

export type RejectResult = {
  outcome: "rejected" | "already_rejected" | "conflict";
  enrollment: EnrollmentRow;
  studentName: string;
  studentTelegramId: number | null;
};

/**
 * Rejects a pending enrollment (same authorization as approval). Idempotent for an already
 * rejected one. Never touches an active or expired enrollment: those return "conflict".
 */
export async function rejectEnrollment(
  db: ServiceClient,
  enrollmentId: string,
  actorProfileId: string,
): Promise<RejectResult> {
  const ctx = await loadContext(db, enrollmentId, actorProfileId);
  const base = { studentName: ctx.studentName, studentTelegramId: ctx.studentTelegramId };
  if (ctx.enrollment.status === "rejected") return { ...base, outcome: "already_rejected", enrollment: ctx.enrollment };
  if (ctx.enrollment.status !== "pending") return { ...base, outcome: "conflict", enrollment: ctx.enrollment };
  const { data, error } = await db
    .from("enrollments")
    .update({ status: "rejected" })
    .eq("id", enrollmentId)
    .eq("status", "pending")
    .select(COLUMNS);
  if (error) dbFail("reject", error);
  const updated = ((data as EnrollmentRow[] | null) ?? [])[0];
  if (updated) return { ...base, outcome: "rejected", enrollment: updated };
  const again = (await loadContext(db, enrollmentId, actorProfileId)).enrollment;
  return { ...base, outcome: again.status === "rejected" ? "already_rejected" : "conflict", enrollment: again };
}

export type ExpireResult = {
  outcome: "expired" | "already_expired" | "conflict";
  enrollment: EnrollmentRow;
  studentName: string;
};

/**
 * Ends an ACTIVE enrollment now (status `expired`, `expires_at` = now unless it was earlier), same
 * authorization as approval. Idempotent for an already expired one; pending/rejected rows are a
 * "conflict" (reject them instead). Re-approving or extending the expiry brings the student back.
 */
export async function expireEnrollment(
  db: ServiceClient,
  enrollmentId: string,
  actorProfileId: string,
  now = new Date(),
): Promise<ExpireResult> {
  const ctx = await loadContext(db, enrollmentId, actorProfileId);
  const base = { studentName: ctx.studentName };
  if (ctx.enrollment.status === "expired") return { ...base, outcome: "already_expired", enrollment: ctx.enrollment };
  if (ctx.enrollment.status !== "active") return { ...base, outcome: "conflict", enrollment: ctx.enrollment };
  const current = ctx.enrollment.expires_at;
  const endsAt = current !== null && new Date(current).getTime() < now.getTime() ? current : now.toISOString();
  const { data, error } = await db
    .from("enrollments")
    .update({ status: "expired", expires_at: endsAt })
    .eq("id", enrollmentId)
    .eq("status", "active")
    .select(COLUMNS);
  if (error) dbFail("expire", error);
  const updated = ((data as EnrollmentRow[] | null) ?? [])[0];
  if (updated) return { ...base, outcome: "expired", enrollment: updated };
  const again = (await loadContext(db, enrollmentId, actorProfileId)).enrollment;
  return { ...base, outcome: again.status === "expired" ? "already_expired" : "conflict", enrollment: again };
}
