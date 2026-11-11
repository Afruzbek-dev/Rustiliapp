import { z } from "zod";
import type { ChoosePayload, ClassifyPayload, ConjugatePayload, FillBlankPayload, MatchPayload } from "@/lib/exercises/types";

const s = z.string().max(2000);
const id = z.string().min(1).max(64);

export const exercisePayloadSchemas = {
  classify: z.object({
    items: z.array(z.object({ id, text: s })).min(1).max(100),
    buckets: z.array(z.object({ id, label: s, hint: s.optional() })).min(2).max(12),
  }),
  fill_blank: z.object({
    items: z.array(z.object({ id, before: s, after: s, hint: s.optional() })).min(1).max(100),
  }),
  conjugate: z.object({ verb: s, pronouns: z.array(s).length(6) }),
  choose: z.object({
    items: z.array(z.object({ id, text: s, options: z.array(s).min(2).max(8) })).min(1).max(100),
  }),
  match: z.object({
    left: z.array(z.object({ id, text: s })).min(1).max(30),
    right: z.array(z.object({ id, text: s })).min(1).max(30),
  }),
} as const;

export type PlayableExercise =
  | { type: "classify"; payload: ClassifyPayload }
  | { type: "fill_blank"; payload: FillBlankPayload }
  | { type: "conjugate"; payload: ConjugatePayload }
  | { type: "choose"; payload: ChoosePayload }
  | { type: "match"; payload: MatchPayload };

/** Validates an exercise payload for its type; null when the type is not playable or the payload is malformed. */
export function parseExercisePayload(type: string, payload: unknown): PlayableExercise | null {
  if (!Object.prototype.hasOwnProperty.call(exercisePayloadSchemas, type)) return null;
  const parsed = exercisePayloadSchemas[type as keyof typeof exercisePayloadSchemas].safeParse(payload);
  return parsed.success ? ({ type, payload: parsed.data } as PlayableExercise) : null;
}
