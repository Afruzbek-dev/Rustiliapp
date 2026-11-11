import "server-only";
import { z } from "zod";
import { maskPhone } from "@/server/teacher-stats";

/**
 * Write side of the teacher/admin management area (students, cohorts, curator groups).
 *
 * Every function takes the ACTOR profile id (always from the verified session, never from the
 * request), validates the raw input with zod and writes through the narrow `ManageDb` port
 * (production: the 0017 service-role SQL functions, which re-check the actor themselves; tests: a
 * fake). Failures come back as `{ ok: false, code, message }`; nothing here throws for expected
 * outcomes.
 *
 * Manual Telegram link (profiles that have a phone but no telegram_id, e.g. created by an admin):
 * the bot cannot adopt such a profile by itself (the phone is "taken" by a profile without a
 * telegram id), so staff link it here. The teacher enters the student's NUMERIC Telegram id; we
 * accept it only if the Bot API confirms it is a private chat with that user (getChat succeeds
 * only for people who have started the bot, which is the case for anyone who tried to log in), then
 * write profiles.telegram_id/telegram_username and mirror the id into the auth user's
 * app_metadata (the login exchange demands both). Usernames are not accepted: the Bot API cannot
 * resolve a user's @username, so it could not be validated.
 */

export type ManageErrorKind =
  | "forbidden"
  | "invalid"
  | "invalid_group"
  | "conflict"
  | "duplicate_name"
  | "duplicate_chat"
  | "telegram_taken"
  | "telegram_required"
  | "student_enrolled"
  | "already_linked"
  | "phone_required"
  | "unverified_telegram"
  | "failed";

export class ManageDbError extends Error {
  constructor(public readonly kind: ManageErrorKind, public readonly op = "manage") {
    super(`manage error in ${op} (${kind})`);
    this.name = "ManageDbError";
  }
}

export type Failure = { ok: false; code: ManageErrorKind; message: string };
export type Outcome<T = object> = ({ ok: true; message: string } & T) | Failure;

const MESSAGES: Record<ManageErrorKind, string> = {
  forbidden: "Sizda bu amal uchun ruxsat yo'q",
  invalid: "Ma'lumot noto'g'ri",
  invalid_group: "Guruh shu kohortaga tegishli emas",
  conflict: "Holat o'zgargan, sahifani yangilang",
  duplicate_name: "Bu nomdagi guruh allaqachon bor",
  duplicate_chat: "Bu Telegram chat boshqa guruhga bog'langan",
  telegram_taken: "Bu Telegram ID boshqa profilga bog'langan",
  telegram_required: "Kurator profilida tasdiqlangan Telegram yo'q",
  student_enrolled: "Bu faol o'quvchini kurator qilib bo'lmaydi",
  already_linked: "Telegram allaqachon ulangan",
  phone_required: "Profilda telefon raqami yo'q",
  unverified_telegram: "Telegram ID tasdiqlanmadi: foydalanuvchi botni ishga tushirgan bo'lishi kerak",
  failed: "Xatolik yuz berdi, qayta urinib ko'ring",
};

export const fail = (code: ManageErrorKind, message = MESSAGES[code]): Failure => ({ ok: false, code, message });
const ok = <T extends object>(message: string, extra?: T): Outcome<T> => ({ ok: true, message, ...(extra as T) });

export interface CuratorCandidate {
  profileId: string;
  name: string;
  /** Masked: never the full number. */
  phone: string | null;
  telegramLinked: boolean;
  telegramUsername: string | null;
  role: string;
}

export interface ManageDb {
  moveStudent(actor: string, enrollmentId: string, groupId: string | null): Promise<{ changed: boolean }>;
  bulkMove(actor: string, cohortId: string, groupId: string | null, enrollmentIds: string[]): Promise<number>;
  reassignGroup(actor: string, cohortId: string, fromGroupId: string, toGroupId: string | null, limit: number): Promise<number>;
  setExpiry(actor: string, enrollmentId: string, expiresAtIso: string): Promise<void>;
  createCohort(actor: string, courseId: string, v: CohortFields): Promise<string>;
  updateCohort(actor: string, cohortId: string, v: CohortFields): Promise<void>;
  setCohortAccess(actor: string, cohortId: string, open: boolean, untilIso: string | null): Promise<void>;
  createGroup(actor: string, cohortId: string, name: string, chatId: string | null): Promise<string>;
  updateGroup(actor: string, groupId: string, name: string, chatId: string | null): Promise<void>;
  assignCurator(actor: string, groupId: string, curatorId: string | null): Promise<{ promoted: boolean }>;
  findCurators(actor: string, query: string): Promise<CuratorCandidate[]>;
  linkTelegram(actor: string, profileId: string, telegramId: number, username: string | null): Promise<void>;
  /** Undo of linkTelegram when the auth mirror failed (only if the profile still carries that id). */
  revertTelegramLink(profileId: string, telegramId: number): Promise<void>;
}

export interface CohortFields {
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  accessUntilIso: string | null;
}

// --- input -----------------------------------------------------------------------------------

const uuid = z.string().uuid();
const nullableUuid = z.preprocess((v) => (v === "" || v === undefined ? null : v), uuid.nullable());
const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s));
const optDate = z.preprocess((v) => (v === "" || v === undefined || v === null ? null : v), dateStr.nullable());
const name = z.string().trim().min(1).max(80);
const chatId = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? null : typeof v === "string" ? v.trim() : v),
  z
    .string()
    .regex(/^-?\d{1,15}$/)
    .refine((s) => s !== "0" && s !== "-0")
    .nullable(),
);

/** End of the given calendar day in Asia/Tashkent (UTC+5, no DST). */
export function endOfTashkentDay(date: string): string {
  return new Date(`${date}T23:59:59+05:00`).toISOString();
}

function mapError(err: unknown): Failure {
  if (err instanceof ManageDbError) return fail(err.kind);
  console.error("manage failed", { code: err instanceof Error ? err.name : "unknown" });
  return fail("failed");
}

async function guarded<T>(run: () => Promise<Outcome<T>>): Promise<Outcome<T>> {
  try {
    return await run();
  } catch (err) {
    return mapError(err);
  }
}

// --- students ---------------------------------------------------------------------------------

export async function moveStudentFn(db: ManageDb, actor: string, input: unknown): Promise<Outcome<{ changed: boolean }>> {
  const p = z.object({ enrollmentId: uuid, groupId: nullableUuid }).safeParse(input);
  if (!p.success) return fail("invalid");
  return guarded(async () => {
    const r = await db.moveStudent(actor, p.data.enrollmentId, p.data.groupId);
    const text = p.data.groupId === null ? "Guruhdan chiqarildi" : "Guruh almashtirildi";
    return ok(r.changed ? text : "Allaqachon shu guruhda", { changed: r.changed });
  });
}

export async function bulkMoveFn(db: ManageDb, actor: string, input: unknown): Promise<Outcome<{ moved: number }>> {
  const p = z
    .object({ cohortId: uuid, groupId: nullableUuid, enrollmentIds: z.array(uuid).min(1).max(100) })
    .safeParse(input);
  if (!p.success) return fail("invalid");
  return guarded(async () => {
    const moved = await db.bulkMove(actor, p.data.cohortId, p.data.groupId, [...new Set(p.data.enrollmentIds)]);
    return ok(`${moved} ta o'quvchi ko'chirildi`, { moved });
  });
}

/** Moves up to 100 students (default: all that fit) from one group to another; run again for the rest. */
export async function reassignGroupFn(db: ManageDb, actor: string, input: unknown): Promise<Outcome<{ moved: number }>> {
  const p = z
    .object({
      cohortId: uuid,
      fromGroupId: uuid,
      toGroupId: nullableUuid,
      limit: z.coerce.number().int().min(1).max(100).default(100),
    })
    .safeParse(input);
  if (!p.success || p.data.toGroupId === p.data.fromGroupId) return fail("invalid");
  return guarded(async () => {
    const moved = await db.reassignGroup(actor, p.data.cohortId, p.data.fromGroupId, p.data.toGroupId, p.data.limit);
    return ok(moved === 0 ? "Ko'chiriladigan o'quvchi yo'q" : `${moved} ta o'quvchi ko'chirildi`, { moved });
  });
}

export async function setExpiryFn(db: ManageDb, actor: string, input: unknown): Promise<Outcome> {
  const p = z.object({ enrollmentId: uuid, expiresOn: dateStr }).safeParse(input);
  if (!p.success) return fail("invalid");
  return guarded(async () => {
    await db.setExpiry(actor, p.data.enrollmentId, endOfTashkentDay(p.data.expiresOn));
    return ok("Muddat yangilandi");
  });
}

export interface TelegramLinkDeps {
  /** Confirms with the Bot API that `id` is a private chat with that user; null when it cannot be confirmed. */
  verifyUser(telegramId: number): Promise<{ username: string | null } | null>;
  /** Mirrors the id into the auth user's app_metadata (the login exchange requires it). */
  mirrorToAuth(profileId: string, telegramId: number): Promise<"ok" | "conflict" | "failed">;
}

export async function linkTelegramFn(
  db: ManageDb,
  deps: TelegramLinkDeps,
  actor: string,
  input: unknown,
): Promise<Outcome> {
  const p = z
    .object({
      profileId: uuid,
      telegramId: z
        .string()
        .trim()
        .regex(/^[1-9]\d{4,14}$/),
    })
    .safeParse(input);
  if (!p.success) return fail("invalid", "Telegram ID faqat raqamlardan iborat bo'lishi kerak");
  const telegramId = Number(p.data.telegramId);
  if (!Number.isSafeInteger(telegramId) || telegramId > 4503599627370495) return fail("invalid");
  return guarded(async () => {
    const verified = await deps.verifyUser(telegramId);
    if (!verified) return fail("unverified_telegram");
    await db.linkTelegram(actor, p.data.profileId, telegramId, verified.username);
    const mirrored = await deps.mirrorToAuth(p.data.profileId, telegramId);
    if (mirrored !== "ok") {
      await db.revertTelegramLink(p.data.profileId, telegramId);
      return mirrored === "conflict" ? fail("telegram_taken") : fail("failed");
    }
    return ok("Telegram ulandi. O'quvchi endi bot orqali kira oladi");
  });
}

// --- cohorts ----------------------------------------------------------------------------------

const cohortShape = z.object({ name, startsOn: optDate, endsOn: optDate });

function cohortFields(v: z.infer<typeof cohortShape> & { accessUntil?: string | null }): CohortFields | null {
  if (v.startsOn && v.endsOn && v.endsOn < v.startsOn) return null;
  return {
    name: v.name,
    startsOn: v.startsOn,
    endsOn: v.endsOn,
    accessUntilIso: v.accessUntil ? endOfTashkentDay(v.accessUntil) : null, // create only: updates never touch it
  };
}

export async function createCohortFn(db: ManageDb, actor: string, input: unknown): Promise<Outcome<{ cohortId: string }>> {
  const p = cohortShape.extend({ courseId: uuid, accessUntil: optDate }).safeParse(input);
  const fields = p.success ? cohortFields(p.data) : null;
  if (!p.success || !fields) return fail("invalid", "Ma'lumot noto'g'ri: sanalarni tekshiring");
  return guarded(async () => {
    const cohortId = await db.createCohort(actor, p.data.courseId, fields);
    return ok("Guruh yaratildi", { cohortId });
  });
}

export async function updateCohortFn(db: ManageDb, actor: string, input: unknown): Promise<Outcome> {
  const p = cohortShape.extend({ cohortId: uuid }).safeParse(input);
  const fields = p.success ? cohortFields(p.data) : null;
  if (!p.success || !fields) return fail("invalid", "Ma'lumot noto'g'ri: sanalarni tekshiring");
  return guarded(async () => {
    await db.updateCohort(actor, p.data.cohortId, fields);
    return ok("Saqlandi");
  });
}

/** open + date => enrollment (and approval) allowed until the end of that day; closed => now. */
export async function setCohortAccessFn(db: ManageDb, actor: string, input: unknown): Promise<Outcome> {
  const p = z.object({ cohortId: uuid, open: z.boolean(), until: optDate }).safeParse(input);
  if (!p.success || (p.data.open && !p.data.until)) return fail("invalid", "Kirish muddatini kiriting");
  return guarded(async () => {
    await db.setCohortAccess(actor, p.data.cohortId, p.data.open, p.data.until ? endOfTashkentDay(p.data.until) : null);
    return ok(p.data.open ? "Qabul ochildi" : "Qabul yopildi");
  });
}

// --- curator groups ---------------------------------------------------------------------------

export async function createGroupFn(db: ManageDb, actor: string, input: unknown): Promise<Outcome<{ groupId: string }>> {
  const p = z.object({ cohortId: uuid, name, chatId }).safeParse(input);
  if (!p.success) return fail("invalid");
  return guarded(async () => {
    const groupId = await db.createGroup(actor, p.data.cohortId, p.data.name, p.data.chatId);
    return ok("Guruh yaratildi", { groupId });
  });
}

export async function updateGroupFn(db: ManageDb, actor: string, input: unknown): Promise<Outcome> {
  const p = z.object({ groupId: uuid, name, chatId }).safeParse(input);
  if (!p.success) return fail("invalid");
  return guarded(async () => {
    await db.updateGroup(actor, p.data.groupId, p.data.name, p.data.chatId);
    return ok("Saqlandi");
  });
}

export async function assignCuratorFn(db: ManageDb, actor: string, input: unknown): Promise<Outcome<{ promoted: boolean }>> {
  const p = z.object({ groupId: uuid, curatorId: nullableUuid }).safeParse(input);
  if (!p.success) return fail("invalid");
  return guarded(async () => {
    const r = await db.assignCurator(actor, p.data.groupId, p.data.curatorId);
    return ok(p.data.curatorId === null ? "Kurator olib tashlandi" : "Kurator tayinlandi", { promoted: r.promoted });
  });
}

export async function findCuratorsFn(db: ManageDb, actor: string, input: unknown): Promise<Outcome<{ candidates: CuratorCandidate[] }>> {
  const p = z.object({ query: z.string().trim().min(1).max(64) }).safeParse(input);
  if (!p.success) return fail("invalid", "Telefon, Telegram ID yoki @username kiriting");
  return guarded(async () => {
    const candidates = await db.findCurators(actor, p.data.query);
    return ok(candidates.length === 0 ? "Hech narsa topilmadi" : `${candidates.length} ta topildi`, { candidates });
  });
}

// --- Supabase adapter (service role) ----------------------------------------------------------

type DbError = { code?: string; message?: string } | null;
type Rpc = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbError }>;
  from(table: string): {
    update(v: Record<string, unknown>): {
      eq(c: string, v: unknown): { eq(c: string, v: unknown): PromiseLike<{ error: DbError }> };
    };
  };
};

/** SQLSTATE + message of the 0017 functions -> typed error kind. */
export function classifyDbError(error: NonNullable<DbError>): ManageErrorKind {
  const msg = error.message ?? "";
  switch (error.code) {
    case "42501":
      return "forbidden";
    case "22023":
      if (msg.includes("telegram_required")) return "telegram_required";
      if (msg.includes("phone_required")) return "phone_required";
      if (msg.includes("invalid group")) return "invalid_group";
      return "invalid";
    case "55000":
      if (msg.includes("student_enrolled")) return "student_enrolled";
      if (msg.includes("already_linked")) return "already_linked";
      return "conflict";
    case "23505":
      if (msg.includes("curator_groups_cohort_name_key")) return "duplicate_name";
      if (msg.includes("telegram_chat_id_key")) return "duplicate_chat";
      if (msg.includes("profiles_telegram_id_key")) return "telegram_taken";
      return "conflict";
    default:
      return "failed";
  }
}

export function supabaseManageDb(sb: Rpc): ManageDb {
  async function call<T>(op: string, fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await sb.rpc(fn, args);
    if (error) {
      const kind = classifyDbError(error);
      if (kind === "failed") console.error("manage rpc failed", { op, code: error.code ?? "unknown" });
      throw new ManageDbError(kind, op);
    }
    return data as T;
  }
  const dates = (v: CohortFields) => ({
    p_name: v.name,
    p_starts: v.startsOn,
    p_ends: v.endsOn,
    p_access: v.accessUntilIso,
  });
  return {
    async moveStudent(actor, enrollmentId, groupId) {
      const rows = await call<{ changed: boolean }[]>("move", "manage_move_student", {
        p_actor: actor,
        p_enrollment: enrollmentId,
        p_group: groupId,
      });
      return { changed: rows?.[0]?.changed === true };
    },
    async bulkMove(actor, cohortId, groupId, ids) {
      const n = await call<number>("bulkMove", "manage_bulk_move", {
        p_actor: actor,
        p_cohort: cohortId,
        p_group: groupId,
        p_enrollments: ids,
      });
      return Number(n ?? 0);
    },
    async reassignGroup(actor, cohortId, from, to, limit) {
      const n = await call<number>("reassignGroup", "manage_reassign_group", {
        p_actor: actor,
        p_cohort: cohortId,
        p_from: from,
        p_to: to,
        p_limit: limit,
      });
      return Number(n ?? 0);
    },
    async setExpiry(actor, enrollmentId, iso) {
      await call("setExpiry", "manage_set_expiry", { p_actor: actor, p_enrollment: enrollmentId, p_expires: iso });
    },
    async createCohort(actor, courseId, v) {
      return call<string>("createCohort", "manage_create_cohort", { p_actor: actor, p_course: courseId, ...dates(v) });
    },
    async updateCohort(actor, cohortId, v) {
      await call("updateCohort", "manage_update_cohort", {
        p_actor: actor,
        p_cohort: cohortId,
        p_name: v.name,
        p_starts: v.startsOn,
        p_ends: v.endsOn,
      });
    },
    async setCohortAccess(actor, cohortId, open, untilIso) {
      await call("setCohortAccess", "manage_set_cohort_access", {
        p_actor: actor,
        p_cohort: cohortId,
        p_open: open,
        p_access: untilIso,
      });
    },
    async createGroup(actor, cohortId, nm, chat) {
      return call<string>("createGroup", "manage_create_group", { p_actor: actor, p_cohort: cohortId, p_name: nm, p_chat: chat });
    },
    async updateGroup(actor, groupId, nm, chat) {
      await call("updateGroup", "manage_update_group", { p_actor: actor, p_group: groupId, p_name: nm, p_chat: chat });
    },
    async assignCurator(actor, groupId, curatorId) {
      const promoted = await call<boolean>("assignCurator", "manage_assign_curator", {
        p_actor: actor,
        p_group: groupId,
        p_curator: curatorId,
      });
      return { promoted: promoted === true };
    },
    async findCurators(actor, query) {
      const rows = await call<Record<string, unknown>[]>("findCurators", "manage_find_curator_candidates", {
        p_actor: actor,
        p_query: query,
      });
      return (rows ?? []).map((r) => ({
        profileId: String(r.profile_id),
        name: typeof r.full_name === "string" && r.full_name ? r.full_name : "Ismsiz foydalanuvchi",
        phone: maskPhone(typeof r.phone === "string" ? r.phone : null),
        telegramLinked: r.telegram_linked === true,
        telegramUsername: typeof r.telegram_username === "string" ? r.telegram_username : null,
        role: String(r.role),
      }));
    },
    async linkTelegram(actor, profileId, telegramId, username) {
      await call("linkTelegram", "manage_link_telegram", {
        p_actor: actor,
        p_profile: profileId,
        p_telegram: telegramId,
        p_username: username,
      });
    },
    async revertTelegramLink(profileId, telegramId) {
      const { error } = await sb
        .from("profiles")
        .update({ telegram_id: null, telegram_username: null })
        .eq("id", profileId)
        .eq("telegram_id", telegramId);
      if (error) console.error("telegram link revert failed", { code: error.code ?? "unknown" });
    },
  };
}
