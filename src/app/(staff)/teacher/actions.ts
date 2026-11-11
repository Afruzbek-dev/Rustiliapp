"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { approveEnrollment, rejectEnrollment } from "@/server/enrollment";
import { requireStaff } from "@/server/guards";
import { appHomeUrl, productionReminderDeps, remindStudent } from "@/server/teacher-reminders";
import {
  approveState,
  failureState,
  rejectState,
  reminderState,
  type ActionState,
} from "@/server/teacher-requests";

const requestSchema = z.object({ enrollmentId: z.string().uuid() });
const reminderSchema = z.object({ studentId: z.string().uuid(), cohortId: z.string().uuid() });

const INVALID: ActionState = { status: "error", message: "Noto'g'ri so'rov" };

/**
 * Every action re-derives the actor from the VERIFIED session (requireStaff redirects anonymous
 * users and non-staff) and never from the form; the form only names the row. Authority over that
 * row is checked again inside approveEnrollment/rejectEnrollment (admin or the course's teacher).
 */
export async function approveRequestAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user } = await requireStaff();
  const parsed = requestSchema.safeParse({ enrollmentId: formData.get("enrollmentId") });
  if (!parsed.success) return INVALID;
  try {
    const res = await approveEnrollment(createServiceClient(), parsed.data.enrollmentId, user.id);
    revalidatePath("/teacher");
    return approveState(res);
  } catch (err) {
    return failureState(err);
  }
}

export async function rejectRequestAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user } = await requireStaff();
  const parsed = requestSchema.safeParse({ enrollmentId: formData.get("enrollmentId") });
  if (!parsed.success) return INVALID;
  try {
    const res = await rejectEnrollment(createServiceClient(), parsed.data.enrollmentId, user.id);
    revalidatePath("/teacher");
    return rejectState(res);
  } catch (err) {
    return failureState(err);
  }
}

export async function remindStudentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff();
  const parsed = reminderSchema.safeParse({ studentId: formData.get("studentId"), cohortId: formData.get("cohortId") });
  if (!parsed.success) return INVALID;
  try {
    const outcome = await remindStudent(
      await productionReminderDeps(),
      parsed.data.studentId,
      parsed.data.cohortId,
      appHomeUrl(),
    );
    revalidatePath("/teacher");
    return reminderState(outcome);
  } catch (err) {
    console.error("reminder action failed", { code: err instanceof Error ? err.name : "unknown" });
    return { status: "error", message: "Xatolik yuz berdi, qayta urinib ko'ring" };
  }
}
