import { z } from "zod";
import { tashkentDay } from "@/lib/gamification/day";
import { grade, type SrsCard } from "@/lib/srs";
import { nextIntervalLabels, type IntervalLabels } from "@/lib/srs-labels";

/** Max NEW (never studied) cards introduced per Asia/Tashkent day. Spec: "10 yangi so'z". */
export const DAILY_NEW_LIMIT = 10;
/** Upper bound of due cards served per session (keeps one page load bounded). */
export const DUE_LIMIT = 200;

export interface WordRow {
  ru: string;
  stress: string | null;
  uz: string;
  gender: string | null;
  exampleRu: string | null;
  exampleUz: string | null;
  /** Absolute http(s) URL when the word has recorded audio; otherwise the UI uses speech synthesis. */
  audioUrl: string | null;
  lessonTitle: string | null;
}

export interface CardRow {
  wordId: string;
  intervalDays: number;
  ease: number;
  reps: number;
  lapses: number;
  /** ISO timestamp */
  dueAt: string;
  isDifficult: boolean;
}

export interface QueueRow extends CardRow {
  word: WordRow;
}

/** Data port of the study queue. The production adapter reads with the USER-scoped client (RLS). */
export interface SrsQueueDb {
  /** Studied cards (first_studied_at not null) with due_at <= now, oldest due first. */
  dueCards(studentId: string, nowIso: string, limit: number): Promise<QueueRow[]>;
  /** Never studied cards (first_studied_at null), stable order. */
  newCards(studentId: string, limit: number): Promise<QueueRow[]>;
  /** Cards whose first_studied_at is >= sinceIso (i.e. new cards introduced today). */
  newStudiedSince(studentId: string, sinceIso: string): Promise<number>;
}

export interface StudyCard {
  wordId: string;
  ru: string;
  stress: string | null;
  uz: string;
  gender: string | null;
  exampleRu: string | null;
  exampleUz: string | null;
  audioUrl: string | null;
  lessonTitle: string | null;
  isDifficult: boolean;
  /** Never studied before this session. */
  isNew: boolean;
  /** The three next-interval labels, from srs.grade. */
  labels: IntervalLabels;
}

export interface StudyQueue {
  cards: StudyCard[];
  dueCount: number;
  newCount: number;
  /** New cards still allowed today after this queue. */
  newRemainingToday: number;
}

/**
 * Start of the Asia/Tashkent calendar day containing `now`, as an instant. Tashkent is UTC+5 all
 * year (no DST since 1991), so the offset is fixed.
 */
export function tashkentDayStart(now: Date): Date {
  return new Date(`${tashkentDay(now)}T00:00:00+05:00`);
}

export function toSrsCard(row: CardRow): SrsCard {
  return {
    interval_days: row.intervalDays,
    ease: row.ease,
    reps: row.reps,
    lapses: row.lapses,
    due: new Date(row.dueAt),
  };
}

function toStudyCard(row: QueueRow, isNew: boolean, now: Date): StudyCard {
  return {
    wordId: row.wordId,
    ...row.word,
    isDifficult: row.isDifficult,
    isNew,
    labels: nextIntervalLabels(toSrsCard(row), now),
  };
}

/**
 * Study queue: due cards (due_at <= now, oldest first), then up to DAILY_NEW_LIMIT new cards per
 * Tashkent day.
 *
 * Daily-cap rule: a card is "new" until its FIRST grade of any kind, which stamps
 * srs_cards.first_studied_at. The cap counts cards whose first_studied_at is on today's Tashkent
 * day, so it holds across reloads and devices, and a new card answered "again" stays counted
 * (it returns through the due queue after 10 min, never as new again).
 */
export async function getStudyQueueWith(
  db: SrsQueueDb,
  studentId: string,
  now: Date = new Date(),
): Promise<StudyQueue> {
  const [due, introduced] = await Promise.all([
    db.dueCards(studentId, now.toISOString(), DUE_LIMIT),
    db.newStudiedSince(studentId, tashkentDayStart(now).toISOString()),
  ]);
  const remaining = Math.max(0, DAILY_NEW_LIMIT - introduced);
  const fresh = remaining > 0 ? (await db.newCards(studentId, remaining)).slice(0, remaining) : [];
  return {
    cards: [...due.map((r) => toStudyCard(r, false, now)), ...fresh.map((r) => toStudyCard(r, true, now))],
    dueCount: due.length,
    newCount: fresh.length,
    newRemainingToday: remaining - fresh.length,
  };
}

// ---------------------------------------------------------------------------------------------
// Grade / difficult handlers
// ---------------------------------------------------------------------------------------------

export interface SrsStore {
  /** Role of the signed-in user (user-scoped client). */
  getRole(userId: string): Promise<string | null>;
  /**
   * USER-scoped read of the student's own card, joined with its word through RLS: null when the
   * card does not exist or its word is not visible (not in an active course of the student).
   */
  getCard(studentId: string, wordId: string): Promise<CardRow | null>;
  /** SERVICE write (srs_apply_grade). true = first study of the card, false = studied before, null = no card. */
  applyGrade(
    studentId: string,
    wordId: string,
    next: { intervalDays: number; ease: number; dueAt: string; reps: number; lapses: number },
  ): Promise<boolean | null>;
  /** SERVICE: daily 'words' task +1. */
  bumpWordsTask(studentId: string): Promise<void>;
  /** SERVICE write; false when the student has no such card. */
  setDifficult(studentId: string, wordId: string, value: boolean): Promise<boolean>;
}

export const gradeBodySchema = z
  .object({ wordId: z.string().uuid(), grade: z.enum(["again", "hard", "good"]) })
  .strict();
export const difficultBodySchema = z.object({ wordId: z.string().uuid(), value: z.boolean() }).strict();

export interface HandlerResult {
  status: number;
  json: Record<string, unknown>;
}

/** Ease is stored as numeric(4,2): round the same way so the next labels match what is stored. */
const round2 = (n: number) => Math.round(n * 100) / 100;

const publicCard = (c: CardRow) => ({
  wordId: c.wordId,
  intervalDays: c.intervalDays,
  ease: c.ease,
  reps: c.reps,
  lapses: c.lapses,
  dueAt: c.dueAt,
  isDifficult: c.isDifficult,
});

async function guarded(
  deps: { store: SrsStore },
  req: { userId: string | null },
  run: () => Promise<HandlerResult>,
): Promise<HandlerResult> {
  if (!req.userId) return { status: 401, json: { error: "unauthenticated" } };
  try {
    const role = await deps.store.getRole(req.userId);
    if (role !== "student") return { status: 403, json: { error: "forbidden" } };
    return await run();
  } catch (e) {
    // Class name only: messages may carry user data.
    console.error("srs: internal error", e instanceof Error ? e.name : "unknown");
    return { status: 500, json: { error: "internal_error" } };
  }
}

/** POST /api/srs/grade {wordId, grade} -> { card, firstStudy }. The student id comes from the session only. */
export function handleSrsGrade(
  deps: { store: SrsStore },
  req: { userId: string | null; body: unknown; now?: Date },
): Promise<HandlerResult> {
  return guarded(deps, req, async () => {
    const body = gradeBodySchema.safeParse(req.body);
    if (!body.success) return { status: 400, json: { error: "invalid_request" } };
    const studentId = req.userId as string;
    const { wordId } = body.data;

    const row = await deps.store.getCard(studentId, wordId);
    if (!row) return { status: 404, json: { error: "not_found" } };

    const now = req.now ?? new Date();
    const next = grade(toSrsCard(row), body.data.grade, now);
    const stored = {
      intervalDays: next.interval_days,
      ease: round2(next.ease),
      dueAt: next.due.toISOString(),
      reps: next.reps,
      lapses: next.lapses,
    };
    const first = await deps.store.applyGrade(studentId, wordId, stored);
    if (first === null) return { status: 404, json: { error: "not_found" } };

    if (first) {
      // Cosmetic counter: a failure must not turn a stored grade into an error response.
      try {
        await deps.store.bumpWordsTask(studentId);
      } catch (e) {
        console.error("srs: daily task bump failed", e instanceof Error ? e.name : "unknown");
      }
    }
    return {
      status: 200,
      json: { card: publicCard({ ...row, ...stored }), firstStudy: first },
    };
  });
}

/** POST /api/srs/difficult {wordId, value} -> { wordId, isDifficult }. */
export function handleSrsDifficult(
  deps: { store: SrsStore },
  req: { userId: string | null; body: unknown },
): Promise<HandlerResult> {
  return guarded(deps, req, async () => {
    const body = difficultBodySchema.safeParse(req.body);
    if (!body.success) return { status: 400, json: { error: "invalid_request" } };
    const studentId = req.userId as string;
    const { wordId, value } = body.data;
    // Same visibility rule as grading: the word must be RLS-visible through the student's own card.
    if (!(await deps.store.getCard(studentId, wordId))) return { status: 404, json: { error: "not_found" } };
    if (!(await deps.store.setDifficult(studentId, wordId, value))) {
      return { status: 404, json: { error: "not_found" } };
    }
    return { status: 200, json: { wordId, isDifficult: value } };
  });
}

export const SRS_MAX_BODY_BYTES = 4 * 1024;
