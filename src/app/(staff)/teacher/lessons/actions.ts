"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import {
  createBlockFn,
  createLessonFn,
  createModuleFn,
  deleteBlockFn,
  importWordsFn,
  reorderBlocksFn,
  requestUploadFn,
  saveBlockFn,
  saveLessonFn,
  saveWordFn,
  setPublishedFn,
  supabaseEditorDb,
  unlinkWordFn,
} from "@/server/content-admin";
import { requireStaff } from "@/server/guards";

/**
 * Every action re-derives the actor from the VERIFIED session (requireStaff) and hands the raw,
 * untrusted input to a content-admin function, which validates it with zod and re-checks that the
 * actor teaches the course (or is admin) before writing.
 */
async function ctx() {
  const { user } = await requireStaff();
  return { actor: user.id, db: supabaseEditorDb(createServiceClient()) };
}

export async function saveLessonAction(input: unknown) {
  const { actor, db } = await ctx();
  const r = await saveLessonFn(db, actor, input);
  if (r.ok) revalidatePath("/teacher/lessons");
  return r;
}
export async function createBlockAction(input: unknown) {
  const { actor, db } = await ctx();
  return createBlockFn(db, actor, input);
}
export async function saveBlockAction(input: unknown) {
  const { actor, db } = await ctx();
  return saveBlockFn(db, actor, input);
}
export async function deleteBlockAction(input: unknown) {
  const { actor, db } = await ctx();
  return deleteBlockFn(db, actor, input);
}
export async function reorderBlocksAction(input: unknown) {
  const { actor, db } = await ctx();
  return reorderBlocksFn(db, actor, input);
}
export async function setPublishedAction(input: unknown) {
  const { actor, db } = await ctx();
  const r = await setPublishedFn(db, actor, input);
  if (r.ok) revalidatePath("/teacher/lessons");
  return r;
}
export async function importWordsAction(input: unknown) {
  const { actor, db } = await ctx();
  return importWordsFn(db, actor, input);
}
export async function saveWordAction(input: unknown) {
  const { actor, db } = await ctx();
  return saveWordFn(db, actor, input);
}
export async function unlinkWordAction(input: unknown) {
  const { actor, db } = await ctx();
  return unlinkWordFn(db, actor, input);
}
export async function requestUploadAction(input: unknown) {
  const { actor, db } = await ctx();
  return requestUploadFn(db, actor, input);
}
export async function createLessonAction(input: unknown) {
  const { actor, db } = await ctx();
  const r = await createLessonFn(db, actor, input);
  if (r.ok) revalidatePath("/teacher/lessons");
  return r;
}
export async function createModuleAction(input: unknown) {
  const { actor, db } = await ctx();
  const r = await createModuleFn(db, actor, input);
  if (r.ok) revalidatePath("/teacher/lessons");
  return r;
}
