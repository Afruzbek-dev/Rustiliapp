"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { TestAnswer } from "@/lib/tests/grade";
import type { ClientItem } from "@/server/tests";
import { TestRunner, type TestRunnerActions } from "./TestRunner";

export type SaveAction = (input: { attemptId: string; exerciseId: string; answer: unknown }) => Promise<{ ok: boolean }>;
export type FinishAction = (input: { attemptId: string; answers: Record<string, unknown> }) => Promise<{ ok: boolean }>;

/** Binds the runner to the server actions of one attempt; the page re-renders with the result on finish. */
export function ActiveTest({
  attemptId,
  title,
  items,
  initialAnswers,
  remainingMs,
  save,
  finish,
}: {
  attemptId: string;
  title: string;
  items: ClientItem[];
  initialAnswers: Record<string, unknown>;
  remainingMs: number | null;
  save: SaveAction;
  finish: FinishAction;
}) {
  const router = useRouter();
  const actions = useMemo<TestRunnerActions>(
    () => ({
      async save(exerciseId, answer: TestAnswer) {
        try {
          return (await save({ attemptId, exerciseId, answer })).ok;
        } catch {
          return false;
        }
      },
      async finish(answers) {
        try {
          return (await finish({ attemptId, answers })).ok;
        } catch {
          return false;
        }
      },
    }),
    [attemptId, save, finish],
  );
  return (
    <TestRunner
      title={title}
      items={items}
      initialAnswers={initialAnswers}
      remainingMs={remainingMs}
      actions={actions}
      onFinished={() => router.refresh()}
    />
  );
}
