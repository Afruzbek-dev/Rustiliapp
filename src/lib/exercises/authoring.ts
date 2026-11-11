import { z } from "zod";
import { exercisePayloadSchemas } from "@/lib/blocks/exercise-payloads";
import { PRONOUNS } from "./types";

/**
 * Authoring-side validation of exercises: payload (sent to students) + key (server only).
 * The editor offers ONLY these types: arrange / listen_pick are not playable in the MVP
 * (ledger T14 I3) and open_text is not authored here.
 */
export const AUTHORABLE_TYPES = ["classify", "fill_blank", "conjugate", "choose", "match"] as const;
export type AuthorableType = (typeof AUTHORABLE_TYPES)[number];

export const TYPE_LABEL: Record<AuthorableType, string> = {
  classify: "Guruhlash",
  fill_blank: "Bo'sh joyni to'ldirish",
  conjugate: "Tuslash",
  choose: "Variant tanlash",
  match: "Juftlash",
};

export function isAuthorableType(t: string): t is AuthorableType {
  return (AUTHORABLE_TYPES as readonly string[]).includes(t);
}

export const MAX_PROMPT = 500;

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const blank = (s: unknown) => typeof s !== "string" || s.trim() === "";

export interface ExerciseWrite {
  type: AuthorableType | "speaking";
  prompt: string | null;
  payload: Record<string, unknown>;
  check_mode: "auto" | "review";
  xp: number;
  /** null for review exercises. Written to exercise_keys only. */
  key: unknown;
}

export type ExerciseCheck = { ok: true; write: ExerciseWrite } | { ok: false; errors: string[] };

export interface ExerciseDraft {
  type: string;
  prompt: string;
  payload?: unknown;
  key?: unknown;
  xp: number;
}

const speakingPayload = z.object({
  maxSeconds: z.number().int().min(15).max(600),
  channel: z.enum(["voice", "video", "both"]),
});
export type SpeakingPayload = z.infer<typeof speakingPayload>;
export const DEFAULT_SPEAKING: SpeakingPayload = { maxSeconds: 180, channel: "both" };
export const SPEAKING_XP = 40;

function issuesOf(e: z.ZodError): string[] {
  return e.issues.slice(0, 5).map((i) => `${i.path.join(".") || "mashq"}: ${i.message}`);
}

/** Validates payload + key of an auto-checked exercise. Strips unknown payload fields (no answers can hide there). */
export function checkAutoExercise(type: string, payload: unknown, key: unknown): { ok: true; payload: Record<string, unknown>; key: unknown } | { ok: false; errors: string[] } {
  if (!isAuthorableType(type)) return { ok: false, errors: ["Bu mashq turi qo'llab-quvvatlanmaydi"] };
  const parsed = exercisePayloadSchemas[type].safeParse(payload);
  if (!parsed.success) return { ok: false, errors: issuesOf(parsed.error) };
  const p = parsed.data as Record<string, unknown>;
  const errors: string[] = [];
  const k = key as Record<string, unknown> | null;
  if (typeof k !== "object" || k === null || Array.isArray(k)) return { ok: false, errors: ["To'g'ri javoblar kiritilmagan"] };

  const uniq = (ids: string[], what: string) => {
    if (new Set(ids).size !== ids.length) errors.push(`${what} takrorlanmasligi kerak`);
  };

  switch (type) {
    case "classify": {
      const items = p.items as { id: string; text: string }[];
      const buckets = p.buckets as { id: string; label: string }[];
      uniq(items.map((i) => i.id), "Element identifikatorlari");
      uniq(buckets.map((b) => b.id), "Guruh identifikatorlari");
      if (items.some((i) => blank(i.text))) errors.push("Bo'sh element bor");
      if (buckets.some((b) => blank(b.label))) errors.push("Guruh nomi bo'sh");
      const bucketIds = new Set(buckets.map((b) => b.id));
      for (const i of items) {
        if (!has(k, i.id) || typeof k[i.id] !== "string" || !bucketIds.has(k[i.id] as string)) errors.push(`«${i.text}» uchun guruh tanlanmagan`);
      }
      if (Object.keys(k).some((id) => !items.some((i) => i.id === id))) errors.push("Kalitda ortiqcha element bor");
      break;
    }
    case "fill_blank": {
      const items = p.items as { id: string; before: string; after: string }[];
      uniq(items.map((i) => i.id), "Element identifikatorlari");
      for (const i of items) {
        if (blank(i.before) && blank(i.after)) errors.push("Gap matni bo'sh");
        const a = k[i.id];
        if (!Array.isArray(a) || a.length === 0 || a.length > 10 || a.some((x) => blank(x) || (x as string).length > 200)) {
          errors.push("Har bir bo'sh joy uchun kamida bitta to'g'ri javob kerak");
        }
      }
      if (Object.keys(k).some((id) => !items.some((i) => i.id === id))) errors.push("Kalitda ortiqcha element bor");
      break;
    }
    case "conjugate": {
      if (blank(p.verb)) errors.push("Fe'l kiritilmagan");
      const forms = k.forms;
      if (!Array.isArray(forms) || forms.length !== 6 || forms.some((f) => blank(f) || (f as string).length > 200)) {
        errors.push("6 ta shaklning hammasi kerak");
      }
      return errors.length ? { ok: false, errors } : { ok: true, payload: { ...p, pronouns: [...PRONOUNS] }, key: { forms } };
    }
    case "choose": {
      const items = p.items as { id: string; text: string; options: string[] }[];
      uniq(items.map((i) => i.id), "Element identifikatorlari");
      for (const i of items) {
        if (blank(i.text)) errors.push("Savol matni bo'sh");
        if (i.options.some(blank)) errors.push(`«${i.text}»: bo'sh variant bor`);
        if (new Set(i.options.map((o) => o.trim().toLowerCase())).size !== i.options.length) errors.push(`«${i.text}»: variantlar takrorlanmasin`);
        const c = k[i.id];
        if (typeof c !== "number" || !Number.isInteger(c) || c < 0 || c >= i.options.length) errors.push(`«${i.text}»: to'g'ri variant tanlanmagan`);
      }
      if (Object.keys(k).some((id) => !items.some((i) => i.id === id))) errors.push("Kalitda ortiqcha element bor");
      break;
    }
    case "match": {
      const left = p.left as { id: string; text: string }[];
      const right = p.right as { id: string; text: string }[];
      uniq(left.map((i) => i.id), "Chap identifikatorlar");
      uniq(right.map((i) => i.id), "O'ng identifikatorlar");
      if (left.some((i) => blank(i.text)) || right.some((i) => blank(i.text))) errors.push("Bo'sh juftlik bor");
      const rightIds = new Set(right.map((r) => r.id));
      const used = new Set<string>();
      for (const l of left) {
        const r = k[l.id];
        if (typeof r !== "string" || !rightIds.has(r)) errors.push(`«${l.text}» uchun juftlik tanlanmagan`);
        else if (used.has(r)) errors.push("Bir o'ng element ikki marta ishlatilgan");
        else used.add(r);
      }
      if (Object.keys(k).some((id) => !left.some((l) => l.id === id))) errors.push("Kalitda ortiqcha element bor");
      break;
    }
  }
  return errors.length ? { ok: false, errors: [...new Set(errors)].slice(0, 8) } : { ok: true, payload: p, key: k };
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v : v == null ? "" : String(v)).slice(0, max);
const arr = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * Whitelists the payload fields of an exercise draft WITHOUT requiring it to be complete, so a
 * half-filled draft can be autosaved while nothing but the playable fields can ever be stored in
 * `payload` (answers live in exercise_keys only).
 */
export function sanitizePayload(type: string, payload: unknown): Record<string, unknown> {
  const p = obj(payload);
  const withHint = (o: Record<string, unknown>) => (typeof o.hint === "string" && o.hint.trim() ? { hint: str(o.hint, 2000) } : {});
  switch (type) {
    case "classify":
      return {
        items: arr(p.items, 100).map((i) => ({ id: str(obj(i).id, 64), text: str(obj(i).text, 2000) })),
        buckets: arr(p.buckets, 12).map((b) => ({ id: str(obj(b).id, 64), label: str(obj(b).label, 2000), ...withHint(obj(b)) })),
      };
    case "fill_blank":
      return {
        items: arr(p.items, 100).map((i) => ({ id: str(obj(i).id, 64), before: str(obj(i).before, 2000), after: str(obj(i).after, 2000), ...withHint(obj(i)) })),
      };
    case "conjugate":
      return { verb: str(p.verb, 2000), pronouns: [...PRONOUNS] };
    case "choose":
      return {
        items: arr(p.items, 100).map((i) => ({ id: str(obj(i).id, 64), text: str(obj(i).text, 2000), options: arr(obj(i).options, 8).map((o) => str(o, 2000)) })),
      };
    case "match":
      return {
        left: arr(p.left, 30).map((i) => ({ id: str(obj(i).id, 64), text: str(obj(i).text, 2000) })),
        right: arr(p.right, 30).map((i) => ({ id: str(obj(i).id, 64), text: str(obj(i).text, 2000) })),
      };
    case "speaking": {
      const sp = speakingPayload.safeParse(p);
      return sp.success ? sp.data : { ...DEFAULT_SPEAKING };
    }
    default:
      return {};
  }
}

/** Full validation of an exercise form: the ONLY way exercise data reaches the database. */
export function buildExerciseWrite(draft: ExerciseDraft): ExerciseCheck {
  const xp = draft.xp;
  if (!Number.isInteger(xp) || xp < 0 || xp > 200) return { ok: false, errors: ["XP 0 dan 200 gacha bo'lishi kerak"] };
  const prompt = (draft.prompt ?? "").trim();
  if (prompt.length > 2000) return { ok: false, errors: ["Topshiriq matni juda uzun"] };

  if (draft.type === "speaking") {
    if (!prompt) return { ok: false, errors: ["Gapirish topshirig'i matnini kiriting"] };
    const sp = speakingPayload.safeParse(draft.payload);
    if (!sp.success) return { ok: false, errors: issuesOf(sp.error) };
    return { ok: true, write: { type: "speaking", prompt, payload: sp.data, check_mode: "review", xp, key: null } };
  }
  if (!isAuthorableType(draft.type)) return { ok: false, errors: ["Bu mashq turi qo'llab-quvvatlanmaydi"] };
  if (!prompt || prompt.length > MAX_PROMPT) return { ok: false, errors: ["Topshiriq matni 1-500 belgi bo'lishi kerak"] };
  const res = checkAutoExercise(draft.type, draft.payload, draft.key);
  if (!res.ok) return res;
  return { ok: true, write: { type: draft.type, prompt, payload: res.payload, check_mode: "auto", xp, key: res.key } };
}
