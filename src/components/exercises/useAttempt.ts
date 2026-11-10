"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnswerMap } from "@/lib/exercises/types";

export type AttemptStatus = "idle" | "loading" | "done" | "error";

export type Answer = AnswerMap[keyof AnswerMap];

/** Response of `POST /api/attempts` (200). */
export type AttemptResult = {
  correct: boolean;
  expected?: unknown;
  perItem?: boolean[];
  xpAwarded: number;
  partCompleted?: boolean;
};

export type AttemptError = "network" | "auth" | "forbidden" | "notfound" | "invalid" | "server";

export interface UseAttempt {
  submit: (answer: Answer) => Promise<AttemptResult | null>;
  retry: () => Promise<AttemptResult | null>;
  status: AttemptStatus;
  result: AttemptResult | null;
  error: AttemptError | null;
  reset: () => void;
}

function isResult(v: unknown): v is AttemptResult {
  return typeof v === "object" && v !== null && typeof (v as AttemptResult).correct === "boolean";
}

function errorFor(http: number | undefined): AttemptError {
  if (http === undefined) return "network";
  if (http === 401) return "auth";
  if (http === 403) return "forbidden";
  if (http === 404) return "notfound";
  if (http === 400) return "invalid";
  return "server";
}

/**
 * Posts an answer and waits for the server verdict (never optimistic).
 * Aborts the in-flight request on unmount.
 */
export function useAttempt(exerciseId: string): UseAttempt {
  const [status, setStatus] = useState<AttemptStatus>("idle");
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [error, setError] = useState<AttemptError | null>(null);
  const controller = useRef<AbortController | null>(null);
  const lastAnswer = useRef<Answer | null>(null);
  const busy = useRef(false);

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  const submit = useCallback(
    async (answer: Answer): Promise<AttemptResult | null> => {
      if (busy.current) return null;
      busy.current = true;
      lastAnswer.current = answer;
      const ctl = new AbortController();
      controller.current = ctl;
      setStatus("loading");
      setError(null);
      try {
        const res = await fetch("/api/attempts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ exerciseId, answer }),
          signal: ctl.signal,
        });
        if (!res.ok) {
          throw Object.assign(new Error(`HTTP ${res.status}`), { httpStatus: res.status });
        }
        const data: unknown = await res.json();
        if (!isResult(data)) throw new Error("Bad response");
        if (ctl.signal.aborted) return null;
        setResult(data);
        setStatus("done");
        return data;
      } catch (e) {
        if (ctl.signal.aborted) return null;
        const http = (e as { httpStatus?: number }).httpStatus;
        setError(errorFor(http));
        setStatus("error");
        return null;
      } finally {
        if (controller.current === ctl) busy.current = false;
      }
    },
    [exerciseId],
  );

  const retry = useCallback(async () => {
    if (lastAnswer.current === null) return null;
    return submit(lastAnswer.current);
  }, [submit]);

  const reset = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    busy.current = false;
    setStatus("idle");
    setResult(null);
    setError(null);
  }, []);

  return { submit, retry, status, result, error, reset };
}
