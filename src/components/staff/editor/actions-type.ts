import type { EditorWord } from "@/lib/editor/types";
import type { CsvRowError } from "@/lib/editor/words-csv";
import type { Result } from "@/server/content-admin";

/** Server actions the editor calls (production: ../../../app/(staff)/teacher/lessons/actions.ts; tests: fakes). */
export interface ExerciseInput {
  type: string;
  prompt: string;
  payload: unknown;
  key: unknown;
  xp: number;
}

export interface EditorActions {
  saveLesson(i: { lessonId: string; title: string; objective: string; expected: string }): Promise<Result<{ updatedAt: string }>>;
  createBlock(i: { partId: string; type: string }): Promise<Result<{ blockId: string; updatedAt: string }>>;
  saveBlock(i: { blockId: string; payload?: Record<string, unknown>; exercise?: ExerciseInput; expected: string }): Promise<Result<{ updatedAt: string }>>;
  deleteBlock(i: { blockId: string }): Promise<Result<object>>;
  reorderBlocks(i: { partId: string; ids: string[] }): Promise<Result<object>>;
  setPublished(i: { lessonId: string; published: boolean }): Promise<Result<{ warnings: string[] }>>;
  importWords(i: { lessonId: string; csv: string }): Promise<
    Result<{ inserted: number; linked: number; skipped: number; errors: CsvRowError[]; duplicates: number; words: EditorWord[] }>
  >;
  saveWord(i: { lessonId: string; wordId: string | null; fields: Omit<EditorWord, "id"> }): Promise<Result<{ words: EditorWord[] }>>;
  unlinkWord(i: { lessonId: string; wordId: string }): Promise<Result<{ words: EditorWord[] }>>;
  requestUpload(i: { lessonId: string; kind: "audio" | "image"; size: number; contentType: string }): Promise<Result<{ path: string; token: string }>>;
  createLesson(i: { moduleId: string; title: string }): Promise<Result<{ lessonId: string }>>;
}

/** Uploads a file to a signed target. Production: supabase browser client; tests: a fake. */
export type Uploader = (path: string, token: string, file: File) => Promise<{ ok: boolean }>;
