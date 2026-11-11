"use client";

import { useEffect } from "react";
import { parseExercisePayload } from "@/lib/blocks/exercise-payloads";
import { UNSUPPORTED_BLOCK_TEXT } from "@/lib/blocks/types";

export interface ExercisePreviewProps {
  exercise: { id: string; type: string; prompt: string | null; payload: unknown } | undefined;
  speaking?: boolean;
  onDone: () => void;
}

/**
 * Teacher preview of an exercise: shows WHAT the student will see, read-only. Nothing is submitted
 * (no attempts, no XP), and no answer key is involved (the preview has none).
 */
export function ExercisePreview({ exercise, speaking = false, onDone }: ExercisePreviewProps) {
  useEffect(() => {
    onDone();
  }, [onDone]);

  if (!exercise) return <p role="status" className="rounded-[var(--radius-lg)] border-2 border-border bg-surface-2 p-4 text-ink-2">{speaking ? "Topshiriq topilmadi." : "Mashq topilmadi."}</p>;
  if (speaking) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-extrabold">Gapirish topshirig&apos;i</h2>
        {exercise.prompt && <p lang="ru" className="rounded-[var(--radius-lg)] border-2 border-border bg-card p-4 text-lg">{exercise.prompt}</p>}
        <p className="text-ink-2">Ko&apos;rib chiqish rejimi: yozib yuborilmaydi.</p>
      </section>
    );
  }
  const playable = parseExercisePayload(exercise.type, exercise.payload);
  if (!playable) return <p role="status" className="rounded-[var(--radius-lg)] border-2 border-border bg-surface-2 p-4 text-ink-2">{UNSUPPORTED_BLOCK_TEXT}</p>;

  let rows: string[] = [];
  switch (playable.type) {
    case "classify":
      rows = [`Guruhlar: ${playable.payload.buckets.map((b) => b.label).join(" / ")}`, ...playable.payload.items.map((i) => i.text)];
      break;
    case "fill_blank":
      rows = playable.payload.items.map((i) => `${i.before} ____ ${i.after}`);
      break;
    case "conjugate":
      rows = [playable.payload.verb, ...playable.payload.pronouns];
      break;
    case "choose":
      rows = playable.payload.items.map((i) => `${i.text}: ${i.options.join(" / ")}`);
      break;
    case "match":
      rows = [...playable.payload.left.map((l) => l.text), "-", ...playable.payload.right.map((r) => r.text)];
      break;
  }
  return (
    <section className="flex flex-col gap-3">
      {exercise.prompt && <h2 className="text-xl font-extrabold">{exercise.prompt}</h2>}
      <ul lang="ru" className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <li key={`${i}:${r}`} className="rounded-[var(--radius-lg)] border-2 border-border bg-card p-3 font-bold">{r}</li>
        ))}
      </ul>
      <p className="text-ink-2">Ko&apos;rib chiqish rejimi: javoblar tekshirilmaydi.</p>
    </section>
  );
}
