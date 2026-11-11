import "server-only";
import { serverEnv } from "@/lib/env";
import { tashkentDay } from "@/lib/gamification/day";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getTelegramApi } from "@/lib/telegram/api-client";

export const REMINDER_TEXT = "Salom! Bugun ham mashq qilishni unutmang.";

export type ReminderOutcome = "sent" | "already_sent" | "not_member" | "no_telegram" | "send_failed";

/** Side-effect port: tests inject fakes, production wiring is `productionReminderDeps`. */
export interface ReminderDeps {
  /** True when the (verified) actor teaches the cohort AND the student is an active student of it. */
  mayRemind(studentId: string, cohortId: string): Promise<boolean>;
  telegramIdOf(studentId: string): Promise<number | null>;
  /** Inserts the (student, day) claim; false when one exists already (a reminder went out today). */
  claim(studentId: string, day: string): Promise<boolean>;
  release(studentId: string, day: string): Promise<void>;
  send(telegramId: number, text: string): Promise<void>;
}

/**
 * At most ONE reminder per student per Tashkent day. The claim row is written BEFORE sending, so
 * two concurrent clicks cannot both send; a failed send gives the claim back so the teacher can retry.
 * Authority is checked first: an id from a form is never trusted on its own.
 */
export async function remindStudent(
  deps: ReminderDeps,
  studentId: string,
  cohortId: string,
  appUrl: string,
  now = new Date(),
): Promise<ReminderOutcome> {
  if (!(await deps.mayRemind(studentId, cohortId))) return "not_member";
  const telegramId = await deps.telegramIdOf(studentId);
  if (telegramId === null) return "no_telegram";
  const day = tashkentDay(now);
  if (!(await deps.claim(studentId, day))) return "already_sent";
  try {
    await deps.send(telegramId, `${REMINDER_TEXT}\n${appUrl}`);
    return "sent";
  } catch (err) {
    // No PII: neither the student, the chat id nor the Telegram description is logged.
    console.error("reminder failed", { code: err instanceof Error ? err.name : "unknown" });
    await deps.release(studentId, day).catch(() => undefined);
    return "send_failed";
  }
}

/** Students that already got today's reminder (service role: the table has no API grants). */
export async function remindedToday(studentIds: string[], now = new Date()): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set();
  const { data, error } = await createServiceClient()
    .from("reminders")
    .select("student_id")
    .eq("day", tashkentDay(now))
    .in("student_id", studentIds);
  if (error) throw new Error(`reminders: read failed (${error.code ?? "unknown"})`);
  return new Set((data ?? []).map((r: { student_id: string }) => r.student_id));
}

export async function productionReminderDeps(): Promise<ReminderDeps> {
  const user = await createClient();
  const service = createServiceClient();
  return {
    async mayRemind(studentId, cohortId) {
      const { data: teaches, error } = await user.rpc("teaches_cohort", { cohort: cohortId });
      if (error) throw new Error(`reminders: authority failed (${error.code ?? "unknown"})`);
      if (teaches !== true) return false;
      const { data, error: memberError } = await user
        .from("enrollments")
        .select("id")
        .eq("cohort_id", cohortId)
        .eq("student_id", studentId)
        .eq("status", "active")
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .limit(1);
      if (memberError) throw new Error(`reminders: membership failed (${memberError.code ?? "unknown"})`);
      return (data ?? []).length > 0;
    },
    async telegramIdOf(studentId) {
      const { data, error } = await service.from("profiles").select("telegram_id").eq("id", studentId).maybeSingle();
      if (error) throw new Error(`reminders: profile failed (${error.code ?? "unknown"})`);
      const id = (data as { telegram_id: number | string | null } | null)?.telegram_id;
      return id === null || id === undefined ? null : Number(id);
    },
    async claim(studentId, day) {
      const { error } = await service.from("reminders").insert({ student_id: studentId, day });
      if (!error) return true;
      if (error.code === "23505") return false;
      throw new Error(`reminders: claim failed (${error.code ?? "unknown"})`);
    },
    async release(studentId, day) {
      await service.from("reminders").delete().eq("student_id", studentId).eq("day", day);
    },
    async send(telegramId, text) {
      await getTelegramApi().sendMessage(telegramId, text);
    },
  };
}

export function appHomeUrl(): string {
  return `${serverEnv().APP_URL.replace(/\/$/, "")}/home`;
}
