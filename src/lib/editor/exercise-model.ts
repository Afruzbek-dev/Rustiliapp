import { PRONOUNS } from "@/lib/exercises/types";

/** Form models of the five authorable exercise types and their conversion to / from payload + key. */
export const genId = () => Math.random().toString(36).slice(2, 8);

const o = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const a = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const s = (v: unknown): string => (typeof v === "string" ? v : "");

export interface ClassifyModel {
  buckets: { id: string; label: string }[];
  items: { id: string; text: string; bucketId: string }[];
}
export interface FillBlankModel {
  items: { id: string; before: string; after: string; hint: string; answers: string }[];
}
export interface ConjugateModel {
  verb: string;
  forms: string[];
}
export interface ChooseModel {
  items: { id: string; text: string; options: string[]; correct: number }[];
}
export interface MatchModel {
  pairs: { id: string; left: string; right: string }[];
}

export const ANSWER_SEPARATOR = "|";

export function emptyModel(type: string): unknown {
  switch (type) {
    case "classify":
      return { buckets: [{ id: genId(), label: "" }, { id: genId(), label: "" }], items: [{ id: genId(), text: "", bucketId: "" }] } satisfies ClassifyModel;
    case "fill_blank":
      return { items: [{ id: genId(), before: "", after: "", hint: "", answers: "" }] } satisfies FillBlankModel;
    case "conjugate":
      return { verb: "", forms: PRONOUNS.map(() => "") } satisfies ConjugateModel;
    case "choose":
      return { items: [{ id: genId(), text: "", options: ["", ""], correct: -1 }] } satisfies ChooseModel;
    default:
      return { pairs: [{ id: genId(), left: "", right: "" }, { id: genId(), left: "", right: "" }] } satisfies MatchModel;
  }
}

export function modelFromDraft(type: string, payload: unknown, key: unknown): unknown {
  const p = o(payload);
  const k = o(key);
  switch (type) {
    case "classify":
      return {
        buckets: a(p.buckets).map((b) => ({ id: s(o(b).id), label: s(o(b).label) })),
        items: a(p.items).map((i) => ({ id: s(o(i).id), text: s(o(i).text), bucketId: s(k[s(o(i).id)]) })),
      } satisfies ClassifyModel;
    case "fill_blank":
      return {
        items: a(p.items).map((i) => ({
          id: s(o(i).id), before: s(o(i).before), after: s(o(i).after), hint: s(o(i).hint),
          answers: a(k[s(o(i).id)]).map(s).join(` ${ANSWER_SEPARATOR} `),
        })),
      } satisfies FillBlankModel;
    case "conjugate": {
      const forms = a(k.forms).map(s);
      return { verb: s(p.verb), forms: PRONOUNS.map((_, i) => forms[i] ?? "") } satisfies ConjugateModel;
    }
    case "choose":
      return {
        items: a(p.items).map((i) => {
          const id = s(o(i).id);
          const c = k[id];
          return { id, text: s(o(i).text), options: a(o(i).options).map(s), correct: typeof c === "number" ? c : -1 };
        }),
      } satisfies ChooseModel;
    default: {
      const right = a(p.right).map((r) => ({ id: s(o(r).id), text: s(o(r).text) }));
      return {
        pairs: a(p.left).map((l) => ({
          id: s(o(l).id), left: s(o(l).text), right: right.find((r) => r.id === k[s(o(l).id)])?.text ?? "",
        })),
      } satisfies MatchModel;
    }
  }
}

/** Deterministic scramble so the right column never lists answers in the same order as the left. */
function scatter<T extends { text: string }>(items: T[]): T[] {
  const hash = (t: string) => [...t].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const out = [...items].sort((x, y) => hash(x.text) - hash(y.text));
  if (items.length > 1 && out.every((x, i) => x === items[i])) out.reverse();
  return out;
}

export function draftFromModel(type: string, model: unknown): { payload: Record<string, unknown>; key: unknown } {
  const m = o(model);
  switch (type) {
    case "classify": {
      const mm = m as unknown as ClassifyModel;
      return {
        payload: { items: mm.items.map((i) => ({ id: i.id, text: i.text })), buckets: mm.buckets.map((b) => ({ id: b.id, label: b.label })) },
        key: Object.fromEntries(mm.items.filter((i) => i.bucketId).map((i) => [i.id, i.bucketId])),
      };
    }
    case "fill_blank": {
      const mm = m as unknown as FillBlankModel;
      return {
        payload: { items: mm.items.map((i) => ({ id: i.id, before: i.before, after: i.after, ...(i.hint.trim() ? { hint: i.hint } : {}) })) },
        key: Object.fromEntries(mm.items.map((i) => [i.id, i.answers.split(ANSWER_SEPARATOR).map((x) => x.trim()).filter(Boolean)])),
      };
    }
    case "conjugate": {
      const mm = m as unknown as ConjugateModel;
      return { payload: { verb: mm.verb, pronouns: [...PRONOUNS] }, key: { forms: mm.forms } };
    }
    case "choose": {
      const mm = m as unknown as ChooseModel;
      return {
        payload: { items: mm.items.map((i) => ({ id: i.id, text: i.text, options: i.options })) },
        key: Object.fromEntries(mm.items.filter((i) => i.correct >= 0).map((i) => [i.id, i.correct])),
      };
    }
    default: {
      const mm = m as unknown as MatchModel;
      const right = scatter(mm.pairs.map((p) => ({ id: `r${p.id}`, text: p.right })));
      return {
        payload: { left: mm.pairs.map((p) => ({ id: p.id, text: p.left })), right },
        key: Object.fromEntries(mm.pairs.map((p) => [p.id, `r${p.id}`])),
      };
    }
  }
}
