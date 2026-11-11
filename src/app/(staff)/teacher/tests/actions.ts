"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import type { ExerciseDraftInput } from "@/components/tests/editor-actions-type";
import type { TestSection } from "@/lib/tests/grade";
import { requireStaff } from "@/server/guards";
import {
  addItemFn,
  createTestFn,
  deleteTestFn,
  removeItemFn,
  reorderItemsFn,
  setTestPublishedFn,
  supabaseTestsAdminDb,
  updateItemFn,
  updateTestFn,
} from "@/server/tests-admin";

/**
 * Every action re-derives the actor from the VERIFIED session (requireStaff) and never from the
 * arguments; the *Fn functions then check that the actor teaches the test's course (admin: any).
 */
async function run<T>(fn: (db: ReturnType<typeof supabaseTestsAdminDb>, actor: string) => Promise<T>): Promise<T> {
  const { user } = await requireStaff();
  const result = await fn(supabaseTestsAdminDb(createServiceClient()), user.id);
  revalidatePath("/teacher/tests");
  return result;
}

export async function createTestAction(i: { moduleId: string; title: string }) {
  return run((db, actor) => createTestFn(db, actor, i));
}
export async function updateTestAction(i: { testId: string; title: string; passScore: number | null; timeLimitMin: number | null; maxAttempts: number }) {
  return run((db, actor) => updateTestFn(db, actor, i));
}
export async function addItemAction(i: { testId: string; section: TestSection; lessonId: string | null; exercise: ExerciseDraftInput }) {
  return run((db, actor) => addItemFn(db, actor, i));
}
export async function updateItemAction(i: { testId: string; exerciseId: string; section: TestSection; lessonId: string | null; exercise: ExerciseDraftInput }) {
  return run((db, actor) => updateItemFn(db, actor, i));
}
export async function removeItemAction(i: { testId: string; exerciseId: string }) {
  return run((db, actor) => removeItemFn(db, actor, i));
}
export async function reorderItemsAction(i: { testId: string; ids: string[] }) {
  return run((db, actor) => reorderItemsFn(db, actor, i));
}
export async function setTestPublishedAction(i: { testId: string; published: boolean }) {
  return run((db, actor) => setTestPublishedFn(db, actor, i));
}
export async function deleteTestAction(i: { testId: string }) {
  return run((db, actor) => deleteTestFn(db, actor, i));
}
