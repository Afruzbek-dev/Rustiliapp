"use client";

import { useState } from "react";
import { ProgressBar } from "@/components/ui";
import type { ChoosePayload } from "@/lib/exercises/types";
import { FeedbackSheet } from "./FeedbackSheet";
import { optionClass, type ExerciseProps, type OptionState } from "./styles";
import { useAttempt } from "./useAttempt";
import { WordCard } from "./WordCard";

export function Choose({ exerciseId, payload, onDone, onExit }: ExerciseProps<ChoosePayload>) {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const attempt = useAttempt(exerciseId);
  const item = payload.items[index];
  if (!item) return null;

  const loading = attempt.status === "loading";
  const answered = attempt.status === "done" && attempt.result !== null;
  const expectedIndex =
    typeof attempt.result?.expected === "number" ? attempt.result.expected : null;
  const expectedText = expectedIndex !== null ? item.options[expectedIndex] : undefined;

  function choose(i: number) {
    setPicked(i);
    void attempt.submit({ itemId: item.id, index: i });
  }

  function next() {
    attempt.reset();
    setPicked(null);
    if (index + 1 >= payload.items.length) onDone?.();
    else setIndex(index + 1);
  }

  function stateOf(i: number): OptionState {
    if (!answered) return "idle";
    if (i === picked) return attempt.result?.correct ? "ok" : "wrong";
    if (!attempt.result?.correct && i === expectedIndex) return "reveal";
    return "idle";
  }

  return (
    <div className="flex flex-col gap-4 pb-56">
      <ProgressBar value={index + (answered ? 1 : 0)} max={payload.items.length} label="Mashq jarayoni" />
      <WordCard key={item.id} text={item.text} />
      <div role="group" aria-label="Javob variantlari" className="grid grid-cols-1 gap-3">
        {item.options.map((opt, i) => (
          <button
            key={i}
            type="button"
            lang="ru"
            className={optionClass(stateOf(i))}
            disabled={loading || answered}
            aria-busy={loading && picked === i ? true : undefined}
            aria-pressed={picked === i}
            onClick={() => choose(i)}
          >
            <span className="text-lg">{opt}</span>
          </button>
        ))}
      </div>
      <FeedbackSheet
        onExit={onExit}
        status={attempt.status}
        result={attempt.result}
        error={attempt.error}
        expectedText={expectedText}
        onContinue={next}
        onRetry={() => void attempt.retry()}
      />
    </div>
  );
}
