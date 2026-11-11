import { checkAutoExercise, isAuthorableType } from "@/lib/exercises/authoring";
import { gradeExercise, isGradableType, parseKey } from "./grade";

export interface CheckTestInput {
  moduleId: string | null;
  passScore: number | null;
  timeLimitMin: number | null;
  items: { type: string; prompt: string | null; payload: unknown; key: unknown; blockId: string | null }[];
}

export interface TestCheck {
  errors: string[];
  warnings: string[];
  /** Atomic scoring units (items, forms, pairs) of all items. */
  totalUnits: number;
}

/**
 * Preflight of publishing a test. The database re-checks the essentials atomically
 * (test_editor_set_published); this adds the per-item validation and readable messages.
 * "Passing score reachable": the test has scoring units and 0 < pass <= 100, and a student who
 * answers everything right scores 100 (verified with the real grader).
 */
export function checkTestForPublish(t: CheckTestInput): TestCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  let totalUnits = 0;

  if (!t.moduleId) errors.push("Test modulga biriktirilmagan");
  if (t.passScore === null) errors.push("O'tish bali kiritilmagan");
  else if (!(t.passScore > 0 && t.passScore <= 100)) errors.push("O'tish bali 1 dan 100 gacha bo'lishi kerak");
  if (t.items.length === 0) errors.push("Testda mashqlar yo'q");

  t.items.forEach((it, i) => {
    const n = i + 1;
    if (it.blockId) {
      errors.push(`${n}-mashq darsdan olingan: test mashqlari testning o'ziga tegishli bo'lishi kerak`);
      return;
    }
    if (!isAuthorableType(it.type) || !isGradableType(it.type)) {
      errors.push(`${n}-mashq turi avtomatik tekshirilmaydi`);
      return;
    }
    const checked = checkAutoExercise(it.type, it.payload, it.key);
    if (!checked.ok) {
      errors.push(`${n}-mashq: ${checked.errors[0] ?? "noto'g'ri"}`);
      return;
    }
    if (!it.prompt || !it.prompt.trim()) errors.push(`${n}-mashq: topshiriq matni yo'q`);
    const key = parseKey(it.type, checked.key);
    if (key === null) {
      errors.push(`${n}-mashq: to'g'ri javoblar noto'g'ri`);
      return;
    }
    // a perfect run must score every unit: proves the key is gradable end to end
    const perfect = gradeExercise(it.type, key, perfectAnswer(it.type, key));
    if (perfect.total === 0 || perfect.correct !== perfect.total) errors.push(`${n}-mashq: to'g'ri javoblar tekshirilmadi`);
    totalUnits += perfect.total;
  });

  if (t.items.length > 0 && totalUnits === 0 && errors.length === 0) errors.push("Testda baholanadigan savollar yo'q");
  if (t.timeLimitMin === null) warnings.push("Vaqt cheklanmagan");
  if (t.passScore !== null && t.passScore === 100) warnings.push("O'tish bali 100%: bitta xato ham o'tkazmaydi");
  return { errors, warnings, totalUnits };
}

function perfectAnswer(type: string, key: unknown): unknown {
  const k = key as Record<string, unknown>;
  switch (type) {
    case "classify":
    case "choose":
      return { answers: k };
    case "fill_blank":
      return { answers: Object.fromEntries(Object.entries(k).map(([id, v]) => [id, (v as string[])[0] ?? ""])) };
    case "conjugate":
      return { forms: (key as { forms: string[] }).forms };
    default:
      return { pairs: Object.entries(k).map(([l, r]) => [l, r as string]) };
  }
}
