"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/components/staff/action-state";
import { createServiceClient } from "@/lib/supabase/service";
import { getTelegramApi } from "@/lib/telegram/api-client";
import { ENR_MSG } from "@/lib/telegram/handlers/enrollment";
import { approveEnrollment, expireEnrollment, rejectEnrollment } from "@/server/enrollment";
import { requireStaff } from "@/server/guards";
import {
  assignCuratorFn,
  bulkMoveFn,
  createCohortFn,
  createGroupFn,
  linkTelegramFn,
  moveStudentFn,
  reassignGroupFn,
  setCohortAccessFn,
  setExpiryFn,
  supabaseManageDb,
  updateCohortFn,
  updateGroupFn,
  type Outcome,
} from "@/server/manage";
import { telegramLinkDeps } from "@/server/telegram-link";
import { failureState } from "@/server/teacher-requests";

/**
 * Server actions of the students / cohorts / curator-groups pages. Each one:
 *  1. derives the ACTOR from the verified session (requireStaff); the form only names rows,
 *  2. validates the raw form input with zod (in the manage.ts function),
 *  3. lets the service-role SQL function / enrollment.ts re-check that the actor is an admin or the
 *     teacher of the row's course (a foreign teacher gets "forbidden", whatever the form says).
 */

const INVALID: ActionState = { status: "error", message: "Noto'g'ri so'rov" };

const text = (fd: FormData, key: string): string | undefined => {
  const v = fd.get(key);
  return typeof v === "string" ? v : undefined;
};

const toState = (r: Outcome<object>): ActionState =>
  r.ok ? { status: "success", message: r.message } : { status: "error", message: r.message };

function refresh() {
  revalidatePath("/teacher/students");
  revalidatePath("/teacher/cohorts");
  revalidatePath("/teacher/curators");
  revalidatePath("/teacher");
}

async function ctx() {
  const { user } = await requireStaff();
  return { actor: user.id, service: createServiceClient() };
}

async function done(r: Outcome<object>): Promise<ActionState> {
  if (r.ok) refresh();
  return toState(r);
}

// --- enrollment status ---------------------------------------------------------------------------

const enrollmentSchema = z.object({ enrollmentId: z.string().uuid(), groupId: z.string().uuid().optional() });

async function notifyOpened(telegramId: number): Promise<void> {
  try {
    await getTelegramApi().sendMessage(telegramId, ENR_MSG.opened);
  } catch (err) {
    console.error("approve notify failed", { code: err instanceof Error ? err.name : "unknown" });
  }
}

export async function approveStudentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { actor, service } = await ctx();
  const p = enrollmentSchema.safeParse({ enrollmentId: text(fd, "enrollmentId"), groupId: text(fd, "groupId") || undefined });
  if (!p.success) return INVALID;
  try {
    const res = await approveEnrollment(service, p.data.enrollmentId, actor, { curatorGroupId: p.data.groupId });
    refresh();
    if (res.outcome === "approved" && res.studentTelegramId !== null) await notifyOpened(res.studentTelegramId);
    if (res.outcome === "approved") return { status: "success", message: "Ochildi" };
    if (res.outcome === "already_approved") return { status: "info", message: "Allaqachon tasdiqlangan" };
    return { status: "error", message: "Guruh yopilgan: avval qabulni oching" };
  } catch (err) {
    return failureState(err);
  }
}

export async function rejectStudentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { actor, service } = await ctx();
  const p = enrollmentSchema.safeParse({ enrollmentId: text(fd, "enrollmentId") });
  if (!p.success) return INVALID;
  try {
    const res = await rejectEnrollment(service, p.data.enrollmentId, actor);
    refresh();
    if (res.outcome === "rejected") return { status: "success", message: "Rad etildi" };
    if (res.outcome === "already_rejected") return { status: "info", message: "Allaqachon rad etilgan" };
    return { status: "error", message: "Holat o'zgargan, sahifani yangilang" };
  } catch (err) {
    return failureState(err);
  }
}

export async function expireStudentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { actor, service } = await ctx();
  const p = enrollmentSchema.safeParse({ enrollmentId: text(fd, "enrollmentId") });
  if (!p.success) return INVALID;
  try {
    const res = await expireEnrollment(service, p.data.enrollmentId, actor);
    refresh();
    if (res.outcome === "expired") return { status: "success", message: "Kirish tugatildi" };
    if (res.outcome === "already_expired") return { status: "info", message: "Allaqachon tugagan" };
    return { status: "error", message: "Faqat faol o'quvchining kirishini tugatish mumkin" };
  } catch (err) {
    return failureState(err);
  }
}

// --- students ---------------------------------------------------------------------------------------

export async function moveStudentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { actor, service } = await ctx();
  return done(await moveStudentFn(supabaseManageDb(service), actor, { enrollmentId: text(fd, "enrollmentId"), groupId: text(fd, "groupId") }));
}

export async function bulkMoveAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { actor, service } = await ctx();
  const ids = fd.getAll("enrollmentIds").filter((v): v is string => typeof v === "string");
  return done(await bulkMoveFn(supabaseManageDb(service), actor, { cohortId: text(fd, "cohortId"), groupId: text(fd, "groupId"), enrollmentIds: ids }));
}

export async function setExpiryAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { actor, service } = await ctx();
  return done(await setExpiryFn(supabaseManageDb(service), actor, { enrollmentId: text(fd, "enrollmentId"), expiresOn: text(fd, "expiresOn") }));
}

export async function linkTelegramAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { actor, service } = await ctx();
  const deps = telegramLinkDeps(service, getTelegramApi());
  return done(await linkTelegramFn(supabaseManageDb(service), deps, actor, { profileId: text(fd, "profileId"), telegramId: text(fd, "telegramId") }));
}

// --- cohorts ----------------------------------------------------------------------------------------

export async function createCohortAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { actor, service } = await ctx();
  return done(
    await createCohortFn(supabaseManageDb(service), actor, {
      courseId: text(fd, "courseId"),
      name: text(fd, "name"),
      startsOn: text(fd, "startsOn"),
      endsOn: text(fd, "endsOn"),
      accessUntil: text(fd, "accessUntil"),
    }),
  );
}

export async function updateCohortAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { actor, service } = await ctx();
  return done(
    await updateCohortFn(supabaseManageDb(service), actor, {
      cohortId: text(fd, "cohortId"),
      name: text(fd, "name"),
      startsOn: text(fd, "startsOn"),
      endsOn: text(fd, "endsOn"),
    }),
  );
}

export async function setCohortAccessAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { actor, service } = await ctx();
  return done(
    await setCohortAccessFn(supabaseManageDb(service), actor, {
      cohortId: text(fd, "cohortId"),
      open: text(fd, "open") === "true",
      until: text(fd, "until"),
    }),
  );
}

// --- curator groups ---------------------------------------------------------------------------------

export async function createGroupAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { actor, service } = await ctx();
  return done(await createGroupFn(supabaseManageDb(service), actor, { cohortId: text(fd, "cohortId"), name: text(fd, "name"), chatId: text(fd, "chatId") }));
}

export async function updateGroupAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { actor, service } = await ctx();
  return done(await updateGroupFn(supabaseManageDb(service), actor, { groupId: text(fd, "groupId"), name: text(fd, "name"), chatId: text(fd, "chatId") }));
}

/** The ONLY web path that grants the curator role: service role, after the actor check in SQL. */
export async function assignCuratorAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { actor, service } = await ctx();
  return done(await assignCuratorFn(supabaseManageDb(service), actor, { groupId: text(fd, "groupId"), curatorId: text(fd, "curatorId") }));
}

export async function reassignGroupAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { actor, service } = await ctx();
  return done(
    await reassignGroupFn(supabaseManageDb(service), actor, {
      cohortId: text(fd, "cohortId"),
      fromGroupId: text(fd, "fromGroupId"),
      toGroupId: text(fd, "toGroupId"),
      limit: text(fd, "limit") || 100,
    }),
  );
}
