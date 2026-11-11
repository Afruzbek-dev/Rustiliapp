import type { BlockType } from "@/lib/blocks/types";

/** Data shapes shared by the editor page, its components and the server actions. */
export interface EditorExercise {
  id: string;
  type: string;
  prompt: string;
  payload: unknown;
  /** Teacher-only: read through the teacher's own RLS-scoped client. */
  key: unknown;
  xp: number;
  /** The exercise is also an item of a test (reusing it as a test item is warned about). */
  isTestItem: boolean;
  /** Students already answered it: its type can no longer be changed. */
  typeLocked?: boolean;
}

export interface EditorBlock {
  id: string;
  type: BlockType;
  published: boolean;
  /** Optimistic-concurrency token: the updated_at string exactly as the database returned it. */
  updatedAt: string;
  payload: Record<string, unknown>;
  exercise: EditorExercise | null;
}

export interface EditorPart {
  id: string;
  position: number;
  kind: "grammar" | "conversation";
  title: string;
  blocks: EditorBlock[];
}

export interface EditorWord {
  id: string;
  ru: string;
  stress: string;
  uz: string;
  pos: string;
  gender: string;
  example_ru: string;
  example_uz: string;
}

export type LessonStatus = "draft" | "published" | "partial";

export interface EditorLesson {
  id: string;
  title: string;
  objective: string;
  updatedAt: string;
  moduleId: string;
  moduleTitle: string;
  modulePosition: number;
  lessonPosition: number;
  parts: EditorPart[];
  words: EditorWord[];
}

export interface TreeModule {
  id: string;
  position: number;
  title: string;
  lessons: { id: string; position: number; title: string; status: LessonStatus }[];
}

export interface EditorData {
  courseId: string;
  courseTitle: string;
  tree: TreeModule[];
  lesson: EditorLesson;
}

export function lessonStatus(blocks: { published: boolean }[]): LessonStatus {
  if (blocks.length === 0) return "draft";
  const n = blocks.filter((b) => b.published).length;
  return n === 0 ? "draft" : n === blocks.length ? "published" : "partial";
}

export const BLOCK_LABEL: Record<string, string> = {
  video: "Video",
  audio: "Audio",
  rule_image: "Qoida rasmi",
  text: "Matn",
  reading: "O'qish",
  exercise: "Mashq",
  speaking: "Gapirish",
  words: "So'zlar",
};

/** Block types the editor offers (reading is not offered; arrange/listen_pick exercises are never offered). */
export const ADDABLE_BLOCKS: BlockType[] = ["video", "audio", "rule_image", "exercise", "words", "text", "speaking"];

export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.)/, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const m = /^\/(embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname);
      id = m ? m[2] : null;
    }
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}
