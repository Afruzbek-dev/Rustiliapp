import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bumpDailyTask } from "./daily-tasks";
import { createClient } from "@/lib/supabase/server";
import { getStudyQueueWith, type CardRow, type QueueRow, type SrsQueueDb, type SrsStore, type StudyQueue } from "./srs";

type Row = Record<string, unknown>;

const WORD_COLS =
  "words!inner(ru, stress, uz, gender, example_ru, example_uz, audio_path, lesson_words(lessons(title)))";
const CARD_COLS = "word_id, interval_days, ease, due_at, reps, lapses, is_difficult";

const fail = (what: string, error: { message: string } | null) => {
  if (error) throw new Error(`srs: ${what}: ${error.message}`);
};
const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

function cardOf(r: Row): CardRow {
  return {
    wordId: r.word_id as string,
    intervalDays: Number(r.interval_days),
    ease: Number(r.ease),
    reps: Number(r.reps),
    lapses: Number(r.lapses),
    dueAt: new Date(r.due_at as string).toISOString(),
    isDifficult: r.is_difficult === true,
  };
}

function queueRowOf(r: Row): QueueRow {
  const w = (one(r.words as Row | Row[] | null) ?? {}) as Row;
  const lw = one(w.lesson_words as Row | Row[] | null);
  const lesson = lw ? one(lw.lessons as Row | Row[] | null) : null;
  const audio = typeof w.audio_path === "string" ? w.audio_path : null;
  return {
    ...cardOf(r),
    word: {
      ru: w.ru as string,
      stress: (w.stress as string | null) ?? null,
      uz: w.uz as string,
      gender: (w.gender as string | null) ?? null,
      exampleRu: (w.example_ru as string | null) ?? null,
      exampleUz: (w.example_uz as string | null) ?? null,
      // Storage-relative paths cannot be played without a signed URL: only absolute URLs are served.
      audioUrl: audio && /^https?:\/\//i.test(audio) ? audio : null,
      lessonTitle: (lesson?.title as string | undefined) ?? null,
    },
  };
}

/** Reads under the student's JWT: RLS hides cards whose word is outside the student's active course. */
export function supabaseQueueDb(sb: SupabaseClient): SrsQueueDb {
  return {
    async dueCards(studentId, nowIso, limit) {
      const { data, error } = await sb
        .from("srs_cards")
        .select(`${CARD_COLS}, ${WORD_COLS}`)
        .eq("student_id", studentId)
        .not("first_studied_at", "is", null)
        .lte("due_at", nowIso)
        .order("due_at", { ascending: true })
        .order("word_id", { ascending: true })
        .limit(limit);
      fail("due cards", error);
      return ((data ?? []) as unknown as Row[]).map(queueRowOf);
    },
    async newCards(studentId, limit) {
      const { data, error } = await sb
        .from("srs_cards")
        .select(`${CARD_COLS}, ${WORD_COLS}`)
        .eq("student_id", studentId)
        .is("first_studied_at", null)
        .order("word_id", { ascending: true })
        .limit(limit);
      fail("new cards", error);
      return ((data ?? []) as unknown as Row[]).map(queueRowOf);
    },
    async newStudiedSince(studentId, sinceIso) {
      const { count, error } = await sb
        .from("srs_cards")
        .select("word_id", { count: "exact", head: true })
        .eq("student_id", studentId)
        .gte("first_studied_at", sinceIso);
      fail("new today", error);
      return count ?? 0;
    },
  };
}

/** Single server entry point for the words screen. */
export async function getStudyQueue(studentId: string): Promise<StudyQueue> {
  const sb = await createClient();
  return getStudyQueueWith(supabaseQueueDb(sb), studentId);
}

/** `user` = user-scoped client (RLS); `service` = service-role client, used only for writes. */
export function createSupabaseSrsStore(user: SupabaseClient, service: SupabaseClient): SrsStore {
  return {
    async getRole(userId) {
      const { data, error } = await user.from("profiles").select("role").eq("id", userId).maybeSingle();
      fail("role", error);
      return (data?.role as string | undefined) ?? null;
    },
    async getCard(studentId, wordId) {
      const { data, error } = await user
        .from("srs_cards")
        .select(`${CARD_COLS}, words!inner(id)`)
        .eq("student_id", studentId)
        .eq("word_id", wordId)
        .maybeSingle();
      fail("card", error);
      return data ? cardOf(data as unknown as Row) : null;
    },
    async applyGrade(studentId, wordId, next) {
      const { data, error } = await service.rpc("srs_apply_grade", {
        p_student: studentId,
        p_word: wordId,
        p_interval: next.intervalDays,
        p_ease: next.ease,
        p_due: next.dueAt,
        p_reps: next.reps,
        p_lapses: next.lapses,
      });
      fail("apply grade", error);
      return data === null || data === undefined ? null : data === true;
    },
    bumpWordsTask: (studentId) => bumpDailyTask(service, studentId, "words", 1),
    async setDifficult(studentId, wordId, value) {
      const { data, error } = await service
        .from("srs_cards")
        .update({ is_difficult: value })
        .eq("student_id", studentId)
        .eq("word_id", wordId)
        .select("word_id");
      fail("difficult", error);
      return (data ?? []).length > 0;
    },
  };
}
