import { payloadSchemas, type BlockType } from "@/lib/blocks/types";
import { buildExerciseWrite } from "@/lib/exercises/authoring";
import { BLOCK_LABEL } from "./types";

export interface CheckBlock {
  id: string;
  type: string;
  payload: unknown;
  exercise: { id: string; type: string; prompt: string | null; payload: unknown; key: unknown; xp: number; isTestItem: boolean } | null;
}
export interface CheckPart {
  position: number;
  title: string;
  blocks: CheckBlock[];
}
export interface PublishCheck {
  errors: string[];
  warnings: string[];
}

/**
 * Can this lesson go live? An ERROR blocks publishing: it would make a block unplayable or a part
 * uncompletable for students (malformed payload, exercise without a valid key, test-only exercise
 * in a block, unsupported type). A WARNING is only shown.
 */
export function checkLessonForPublish(parts: CheckPart[], lessonWordCount: number, lessonWordIds: ReadonlySet<string>): PublishCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const filled = parts.filter((p) => p.blocks.length > 0);
  if (filled.length === 0) errors.push("Darsda hech bo'lmaganda bitta blok bo'lishi kerak");

  for (const part of parts) {
    if (part.blocks.length === 0) {
      if (filled.length > 0) warnings.push(`${part.title} bo'sh: o'quvchilar yo'lida ko'rinmaydi`);
      continue;
    }
    let needsWork = false;
    part.blocks.forEach((b, i) => {
      const where = `${part.title}, ${i + 1}-blok (${BLOCK_LABEL[b.type] ?? b.type})`;
      const schema = (payloadSchemas as Record<string, (typeof payloadSchemas)[BlockType]>)[b.type];
      if (!schema) {
        errors.push(`${where}: qo'llab-quvvatlanmaydigan blok turi`);
        return;
      }
      if (b.type === "exercise" || b.type === "speaking") {
        const ex = b.exercise;
        if (!ex) {
          errors.push(`${where}: mashq topilmadi`);
          return;
        }
        needsWork = true;
        if ((b.type === "speaking") !== (ex.type === "speaking")) {
          errors.push(`${where}: mashq turi blokka mos kelmaydi`);
          return;
        }
        if (ex.isTestItem) {
          errors.push(`${where}: bu mashq test elementi, darsda ko'rsatilmaydi`);
          return;
        }
        const res = buildExerciseWrite({ type: ex.type, prompt: ex.prompt ?? "", payload: ex.payload, key: ex.key, xp: ex.xp });
        if (!res.ok) errors.push(`${where}: ${res.errors[0]}`);
        return;
      }
      const parsed = schema.safeParse(b.payload ?? {});
      if (!parsed.success) {
        errors.push(`${where}: ma'lumot to'liq emas`);
        return;
      }
      if (b.type === "words" && lessonWordCount === 0) errors.push(`${where}: darsda so'z yo'q`);
      if (b.type === "text" || b.type === "reading") {
        const g = (parsed.data as { glossary?: { wordId: string }[] }).glossary ?? [];
        if (g.some((e) => !lessonWordIds.has(e.wordId))) warnings.push(`${where}: lug'atdagi ba'zi so'zlar darsdan olib tashlangan`);
      }
    });
    if (!needsWork) warnings.push(`${part.title}: mashq yo'q, o'quvchi faqat o'qib chiqadi`);
  }
  return { errors, warnings };
}
