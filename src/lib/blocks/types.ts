import { z } from "zod";

/**
 * Block payload schemas, keyed by `blocks.type`. Shared by the student player and (Task 26)
 * the teacher editor. Payloads are teacher-authored jsonb, so students' pages must never trust
 * them blindly: `parseBlock` never throws and reports unknown/malformed data as `unsupported`.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.string().max(max).optional();
const uuid = z.string().uuid();
const duration = z.number().int().min(0).max(86_400).optional();

/** Object path inside the private `content` bucket: relative, no traversal. */
export const storagePath = z
  .string()
  .min(1)
  .max(300)
  .refine((p) => !p.startsWith("/") && !p.includes("..") && !p.includes("\\") && !/[\u0000-\u001f]/.test(p), {
    message: "invalid storage path",
  });

export const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export const videoPayload = z.object({
  provider: z.literal("youtube"),
  videoId: z.string().regex(YOUTUBE_ID),
  title: text(200),
  durationSec: duration,
});

export const audioPayload = z.object({
  path: storagePath,
  title: text(200),
  durationSec: duration,
  transcript: optText(10_000),
});

export const ruleImagePayload = z.object({
  path: storagePath,
  alt: text(300),
  caption: optText(500),
});

export const glossaryEntry = z.object({ surface: text(80), wordId: uuid });

const textLike = z.object({
  title: optText(200),
  /** Plain text; paragraphs are separated by a blank line. */
  body: text(20_000),
  glossary: z.array(glossaryEntry).max(500).optional(),
});
export const textPayload = textLike;
export const readingPayload = textLike;

export const exercisePayload = z.object({ exerciseId: uuid });
export const speakingPayload = z.object({ exerciseId: uuid });
/** The words block uses the lesson's words; it carries no data of its own. */
export const wordsPayload = z.object({}).passthrough();

export type VideoPayload = z.infer<typeof videoPayload>;
export type AudioPayload = z.infer<typeof audioPayload>;
export type RuleImagePayload = z.infer<typeof ruleImagePayload>;
export type TextPayload = z.infer<typeof textPayload>;
export type GlossaryEntry = z.infer<typeof glossaryEntry>;
export type ExerciseRefPayload = z.infer<typeof exercisePayload>;

export const BLOCK_TYPES = ["video", "audio", "rule_image", "text", "reading", "exercise", "speaking", "words"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const payloadSchemas = {
  video: videoPayload,
  audio: audioPayload,
  rule_image: ruleImagePayload,
  text: textPayload,
  reading: readingPayload,
  exercise: exercisePayload,
  speaking: speakingPayload,
  words: wordsPayload,
} as const satisfies Record<BlockType, z.ZodTypeAny>;

export interface BlockRow {
  id: string;
  type: string;
  payload: unknown;
}

export type ParsedBlock =
  | { id: string; type: "video"; payload: VideoPayload }
  | { id: string; type: "audio"; payload: AudioPayload }
  | { id: string; type: "rule_image"; payload: RuleImagePayload }
  | { id: string; type: "text"; payload: TextPayload }
  | { id: string; type: "reading"; payload: TextPayload }
  | { id: string; type: "exercise"; payload: ExerciseRefPayload }
  | { id: string; type: "speaking"; payload: ExerciseRefPayload }
  | { id: string; type: "words"; payload: Record<string, unknown> };

export type UnsupportedBlock = { id: string; type: "unsupported"; originalType: string };
export type BlockResult = ParsedBlock | UnsupportedBlock;

export const UNSUPPORTED_BLOCK_TEXT = "Bu blok qo'llab-quvvatlanmaydi";

/** Never throws: unknown type or malformed payload -> `{ type: "unsupported" }`. */
export function parseBlock(row: BlockRow): BlockResult {
  const originalType = String(row?.type ?? "");
  const id = String(row?.id ?? "");
  const unsupported: UnsupportedBlock = { id, type: "unsupported", originalType };
  if (!(BLOCK_TYPES as readonly string[]).includes(originalType)) return unsupported;
  const type = originalType as BlockType;
  const parsed = payloadSchemas[type].safeParse(row.payload ?? {});
  if (!parsed.success) return unsupported;
  return { id, type, payload: parsed.data } as ParsedBlock;
}
