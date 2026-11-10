"use client";

import { useEffect, useMemo } from "react";
import { Choose, Classify, Conjugate, FillBlank, Match } from "@/components/exercises";
import { parseExercisePayload } from "@/lib/blocks/exercise-payloads";
import { UNSUPPORTED_BLOCK_TEXT } from "@/lib/blocks/types";

export interface ExerciseBlockProps {
  exercise: { id: string; type: string; prompt: string | null; payload: unknown } | undefined;
  /**
   * Fires when the exercise component reports it is finished: after a correct answer for
   * Conjugate/Match, and after each item for Classify/FillBlank/Choose (those advance after a wrong
   * answer too, once the student taps "Tushundim"). So "done" here means "went through the
   * exercise", NOT "answered everything correctly": the real gate is the server-side completePart
   * that runs after the last block, which lists the exercises still to redo.
   */
  onDone: () => void;
  onExit: () => void;
}

export function ExerciseBlock({ exercise, onDone, onExit }: ExerciseBlockProps) {
  const playable = useMemo(() => (exercise ? parseExercisePayload(exercise.type, exercise.payload) : null), [exercise]);

  // A missing / malformed / not-checkable exercise must not trap the student.
  useEffect(() => {
    if (!playable) onDone();
  }, [playable, onDone]);

  if (!exercise || !playable) {
    return (
      <p role="status" className="rounded-[var(--radius-lg)] border-2 border-border bg-surface-2 p-4 text-ink-2">
        {exercise ? UNSUPPORTED_BLOCK_TEXT : "Mashq topilmadi."}
      </p>
    );
  }

  const common = { exerciseId: exercise.id, onDone, onExit };
  return (
    <section className="flex flex-col gap-3">
      {exercise.prompt && <h2 className="text-xl font-extrabold">{exercise.prompt}</h2>}
      {playable.type === "classify" && <Classify {...common} payload={playable.payload} />}
      {playable.type === "fill_blank" && <FillBlank {...common} payload={playable.payload} />}
      {playable.type === "conjugate" && <Conjugate {...common} payload={playable.payload} />}
      {playable.type === "choose" && <Choose {...common} payload={playable.payload} />}
      {playable.type === "match" && <Match {...common} payload={playable.payload} />}
    </section>
  );
}
