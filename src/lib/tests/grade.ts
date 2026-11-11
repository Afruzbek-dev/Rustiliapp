import { z } from "zod";
import { check } from "@/lib/exercises/check";
import type { AnswerMap, ExerciseType, KeyMap } from "@/lib/exercises/types";

/**
 * Pure grading of a whole module test. Reuses check() (the same code that grades lesson exercises):
 * every exercise is split into atomic UNITS (an item, a conjugation form, a match pair) and each unit
 * is checked with a one-entry key, so a partly right exercise earns partial credit.
 * Nothing here runs in the browser with a key: keys come from exercise_keys on the server only.
 */

export const TEST_SECTIONS = ["vocab", "grammar", "reading", "listening", "writing"] as const;
export type TestSection = (typeof TEST_SECTIONS)[number];

export const SECTION_LABEL: Record<TestSection, string> = {
  vocab: "Lug'at",
  grammar: "Grammatika",
  reading: "O'qish",
  listening: "Tinglash",
  writing: "Yozish",
};

export const GRADABLE_TYPES = ["classify", "fill_blank", "conjugate", "choose", "match"] as const;
export type GradableType = (typeof GRADABLE_TYPES)[number];
export const isGradableType = (t: string): t is GradableType => (GRADABLE_TYPES as readonly string[]).includes(t);

/** Below this share a section is flagged for review ("Qayta ko'ring"). */
export const WEAK_SECTION_PERCENT = 50;

// ---- answers sent by the client (one object per exercise) ------------------------------------
const id = z.string().min(1).max(64);
const text = z.string().max(200);
const sizeCap = (n: number) => (r: Record<string, unknown>) => Object.keys(r).length <= n;

export const testAnswerSchemas: Record<GradableType, z.ZodTypeAny> = {
  classify: z.object({ answers: z.record(id, id).refine(sizeCap(100)) }).strict(),
  fill_blank: z.object({ answers: z.record(id, text).refine(sizeCap(100)) }).strict(),
  choose: z.object({ answers: z.record(id, z.number().int().min(0).max(1000)).refine(sizeCap(100)) }).strict(),
  conjugate: z.object({ forms: z.array(text).max(6) }).strict(),
  match: z.object({ pairs: z.array(z.tuple([id, id])).max(50) }).strict(),
};

export type TestAnswer =
  | { answers: Record<string, string | number> }
  | { forms: string[] }
  | { pairs: [string, string][] };

export function parseTestAnswer(type: string, raw: unknown): TestAnswer | null {
  if (!isGradableType(type)) return null;
  const r = testAnswerSchemas[type].safeParse(raw);
  return r.success ? (r.data as TestAnswer) : null;
}

// ---- keys (server only) -----------------------------------------------------------------------
const keySchemas: Record<GradableType, z.ZodTypeAny> = {
  classify: z.record(z.string()),
  fill_blank: z.record(z.array(z.string())),
  conjugate: z.object({ forms: z.array(z.string()) }),
  choose: z.record(z.number()),
  match: z.record(z.string()),
};

export function parseKey(type: string, raw: unknown): unknown | null {
  if (!isGradableType(type)) return null;
  const r = keySchemas[type].safeParse(raw);
  return r.success ? r.data : null;
}

// ---- grading -----------------------------------------------------------------------------------
export interface ExerciseResult {
  correct: number;
  total: number;
  /** unit id -> right? (item id, `f<index>` for conjugation forms, left id for match pairs) */
  units: Record<string, boolean>;
}

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** `key` must come from parseKey (valid shape). A missing / malformed answer scores zero for its units. */
export function gradeExercise(type: GradableType, key: unknown, answer: unknown): ExerciseResult {
  const parsed = parseTestAnswer(type, answer);
  const units: Record<string, boolean> = {};

  if (type === "conjugate") {
    const k = key as KeyMap["conjugate"];
    const forms = parsed && "forms" in parsed ? parsed.forms : [];
    const padded = k.forms.map((_, i) => (typeof forms[i] === "string" ? forms[i] : ""));
    const res = check("conjugate", k, { forms: padded } as AnswerMap["conjugate"]);
    k.forms.forEach((_, i) => {
      units[`f${i}`] = res.perItem?.[i] === true;
    });
  } else if (type === "match") {
    const k = key as KeyMap["match"];
    const pairs = parsed && "pairs" in parsed ? parsed.pairs : [];
    for (const left of Object.keys(k)) {
      const given = pairs.find(([l]) => l === left);
      units[left] = given
        ? check("match", { [left]: k[left] }, { pairs: [[given[0], given[1]]] } as AnswerMap["match"]).correct
        : false;
    }
  } else {
    const k = key as Record<string, unknown>;
    const given = parsed && "answers" in parsed ? parsed.answers : {};
    for (const itemId of Object.keys(k)) {
      const value = has(given, itemId) ? given[itemId] : undefined;
      if (value === undefined) {
        units[itemId] = false;
        continue;
      }
      const a =
        type === "classify"
          ? { itemId, bucketId: String(value) }
          : type === "fill_blank"
            ? { itemId, value: String(value) }
            : { itemId, index: Number(value) };
      units[itemId] = check(type as ExerciseType, { [itemId]: k[itemId] } as never, a as never).correct;
    }
  }
  const values = Object.values(units);
  return { correct: values.filter(Boolean).length, total: values.length, units };
}

export interface GradeItem {
  exerciseId: string;
  section: TestSection;
  lessonId: string | null;
  type: GradableType;
  key: unknown;
  answer: unknown;
}

export interface TestGrade {
  correct: number;
  total: number;
  /** percent 0..100, two decimals */
  score: number;
  passed: boolean;
  /** section -> percent (only sections that have units) */
  sectionScores: Record<string, number>;
  itemResults: Record<string, ExerciseResult>;
}

export const percent = (correct: number, total: number): number => (total > 0 ? Math.round((correct / total) * 10000) / 100 : 0);

export function gradeTest(items: GradeItem[], passScore: number | null): TestGrade {
  const itemResults: Record<string, ExerciseResult> = {};
  const bySection = new Map<string, { correct: number; total: number }>();
  let correct = 0;
  let total = 0;
  for (const it of items) {
    const r = gradeExercise(it.type, it.key, it.answer);
    itemResults[it.exerciseId] = r;
    correct += r.correct;
    total += r.total;
    const s = bySection.get(it.section) ?? { correct: 0, total: 0 };
    s.correct += r.correct;
    s.total += r.total;
    bySection.set(it.section, s);
  }
  const sectionScores: Record<string, number> = {};
  for (const [section, s] of bySection) if (s.total > 0) sectionScores[section] = percent(s.correct, s.total);
  const score = percent(correct, total);
  return { correct, total, score, passed: score >= (passScore ?? 0), sectionScores, itemResults };
}

// ---- breakdown and recommendations --------------------------------------------------------------
export interface SectionBreakdown {
  section: TestSection;
  label: string;
  correct: number;
  total: number;
  percent: number;
}

export function sectionBreakdown(
  items: { exerciseId: string; section: TestSection }[],
  itemResults: Record<string, { correct: number; total: number }>,
): SectionBreakdown[] {
  const out: SectionBreakdown[] = [];
  for (const section of TEST_SECTIONS) {
    let correct = 0;
    let total = 0;
    for (const it of items) {
      if (it.section !== section) continue;
      const r = itemResults[it.exerciseId];
      if (!r) continue;
      correct += r.correct;
      total += r.total;
    }
    if (total > 0) out.push({ section, label: SECTION_LABEL[section], correct, total, percent: percent(correct, total) });
  }
  return out;
}

export interface Recommendation {
  section: TestSection;
  label: string;
  percent: number;
  /** Lessons (in course order) of the items the student got wrong in this weak section. */
  lessonIds: string[];
}

/** Sections under WEAK_SECTION_PERCENT, each pointing at the lessons its wrong items belong to. */
export function recommend(
  items: { exerciseId: string; section: TestSection; lessonId: string | null }[],
  itemResults: Record<string, { correct: number; total: number }>,
  lessonOrder: Map<string, number>,
): Recommendation[] {
  const out: Recommendation[] = [];
  for (const s of sectionBreakdown(items, itemResults)) {
    if (s.percent >= WEAK_SECTION_PERCENT) continue;
    const ids = new Set<string>();
    for (const it of items) {
      const r = itemResults[it.exerciseId];
      if (it.section === s.section && it.lessonId && r && r.correct < r.total) ids.add(it.lessonId);
    }
    const lessonIds = [...ids].sort((a, b) => (lessonOrder.get(a) ?? 1e9) - (lessonOrder.get(b) ?? 1e9));
    out.push({ section: s.section, label: s.label, percent: s.percent, lessonIds });
  }
  return out;
}
