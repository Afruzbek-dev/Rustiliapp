"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireStudent } from "@/server/guards";
import { finishTest, saveTestAnswer, startTest, TestError } from "@/server/tests";
import { createSupabaseTestStore } from "@/server/tests-store";

/**
 * Server actions of the student test flow. Each one re-derives the student from the verified session
 * (never from the arguments), checks the role, validates its input and never returns keys.
 */
export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; code: string };

const uuid = z.string().uuid();

async function context() {
  const { user, role } = await requireStudent();
  if (role !== "student") return null;
  return { studentId: user.id, store: createSupabaseTestStore(await createClient(), createServiceClient()) };
}

function failure(err: unknown): { ok: false; code: string } {
  if (err instanceof TestError) return { ok: false, code: err.code };
  console.error("test action failed", { name: err instanceof Error ? err.name : "unknown" });
  return { ok: false, code: "failed" };
}

export async function startTestAction(input: { testId: string }): Promise<ActionResult<{ attemptId: string }>> {
  const p = z.object({ testId: uuid }).safeParse(input);
  if (!p.success) return { ok: false, code: "invalid" };
  const ctx = await context();
  if (!ctx) return { ok: false, code: "not_found" };
  try {
    return { ok: true, ...(await startTest(ctx.store, ctx.studentId, p.data.testId)) };
  } catch (err) {
    return failure(err);
  }
}

export async function saveTestAnswerAction(input: {
  attemptId: string;
  exerciseId: string;
  answer: unknown;
}): Promise<ActionResult<{ status: "saved" | "finished" | "expired" }>> {
  const p = z.object({ attemptId: uuid, exerciseId: uuid, answer: z.unknown() }).safeParse(input);
  if (!p.success) return { ok: false, code: "invalid" };
  const ctx = await context();
  if (!ctx) return { ok: false, code: "not_found" };
  try {
    return { ok: true, status: await saveTestAnswer(ctx.store, ctx.studentId, { ...p.data, answer: p.data.answer }) };
  } catch (err) {
    return failure(err);
  }
}

export async function finishTestAction(input: { attemptId: string; answers: Record<string, unknown> }): Promise<ActionResult> {
  const p = z.object({ attemptId: uuid, answers: z.record(z.string().uuid(), z.unknown()) }).safeParse(input);
  if (!p.success) return { ok: false, code: "invalid" };
  const ctx = await context();
  if (!ctx) return { ok: false, code: "not_found" };
  try {
    await finishTest(ctx.store, ctx.studentId, p.data);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}
