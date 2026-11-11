import { PRONOUNS } from "@/lib/exercises/types";
import type { GradableType } from "./grade";

/**
 * Per-item review lines for the result screen (built AFTER the attempt is finished). `expected` is
 * null whenever the answers must stay hidden (the student may still retake the test).
 */
export interface ReviewLine {
  question: string;
  yours: string;
  expected: string | null;
  ok: boolean;
}

const o = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const a = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const s = (v: unknown): string => (typeof v === "string" ? v : "");
const NONE = "Javob berilmagan";

export function reviewLines(
  type: GradableType,
  payload: unknown,
  key: unknown | null,
  answer: unknown,
  units: Record<string, boolean>,
): ReviewLine[] {
  const p = o(payload);
  const k = key === null ? null : o(key);
  const ans = o(answer);
  const given = o(ans.answers);
  const reveal = (text: string): string | null => (k === null ? null : text);

  switch (type) {
    case "classify": {
      const buckets = a(p.buckets).map((b) => ({ id: s(o(b).id), label: s(o(b).label) }));
      const label = (id: unknown) => buckets.find((b) => b.id === id)?.label ?? NONE;
      return a(p.items).map((raw) => {
        const it = o(raw);
        const id = s(it.id);
        return { question: s(it.text), yours: label(given[id]), expected: reveal(label(k?.[id])), ok: units[id] === true };
      });
    }
    case "fill_blank":
      return a(p.items).map((raw) => {
        const it = o(raw);
        const id = s(it.id);
        const v = typeof given[id] === "string" && given[id] !== "" ? (given[id] as string) : NONE;
        return {
          question: `${s(it.before)} ___ ${s(it.after)}`.trim(),
          yours: v,
          expected: reveal(a(k?.[id]).map(s).join(" / ")),
          ok: units[id] === true,
        };
      });
    case "choose":
      return a(p.items).map((raw) => {
        const it = o(raw);
        const id = s(it.id);
        const options = a(it.options).map(s);
        const pick = (i: unknown) => (typeof i === "number" ? (options[i] ?? NONE) : NONE);
        return { question: s(it.text), yours: pick(given[id]), expected: reveal(pick(k?.[id])), ok: units[id] === true };
      });
    case "conjugate": {
      const forms = a(ans.forms).map(s);
      const expectedForms = a(k?.forms).map(s);
      return PRONOUNS.map((pronoun, i) => ({
        question: `${pronoun} (${s(p.verb)})`,
        yours: forms[i] ? forms[i] : NONE,
        expected: reveal(expectedForms[i] ?? ""),
        ok: units[`f${i}`] === true,
      }));
    }
    default: {
      const left = a(p.left).map((l) => ({ id: s(o(l).id), text: s(o(l).text) }));
      const right = a(p.right).map((r) => ({ id: s(o(r).id), text: s(o(r).text) }));
      const text = (id: unknown) => right.find((r) => r.id === id)?.text ?? NONE;
      const pairs = a(ans.pairs).map((x) => a(x));
      return left.map((l) => ({
        question: l.text,
        yours: text(pairs.find((x) => x[0] === l.id)?.[1]),
        expected: reveal(text(k?.[l.id])),
        ok: units[l.id] === true,
      }));
    }
  }
}
