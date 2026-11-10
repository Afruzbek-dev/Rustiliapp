"use client";

import { useEffect, useRef } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui";
import type { AttemptError, AttemptResult, AttemptStatus } from "./useAttempt";

export interface FeedbackSheetProps {
  status: AttemptStatus;
  result: AttemptResult | null;
  error?: AttemptError | null;
  /** Human readable expected answer (shown when the answer was wrong). */
  expectedText?: string;
  hint?: string;
  onContinue: () => void;
  onRetry: () => void;
  /** When set, non-retryable errors (forbidden/notfound/invalid) offer an "Orqaga" exit. */
  onExit?: () => void;
}

const ERROR_TEXT: Record<AttemptError, string> = {
  network: "Ulanishda xatolik. Internetni tekshirib, qayta urinib ko'ring.",
  server: "Server javob bermadi. Qayta urinib ko'ring.",
  auth: "Seans tugagan. Qayta kiring va yana urinib ko'ring.",
  forbidden: "Bu mashqni bajarishga ruxsat yo'q.",
  notfound: "Mashq topilmadi.",
  invalid: "Javob noto'g'ri formatda. Sahifani yangilang.",
};

const RETRYABLE: AttemptError[] = ["network", "server"];

/** Bottom-pinned verdict. Takes focus when it appears. */
export function FeedbackSheet({
  status,
  result,
  error,
  expectedText,
  hint,
  onContinue,
  onRetry,
  onExit,
}: FeedbackSheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = status === "done" || status === "error";

  useEffect(() => {
    if (visible) ref.current?.focus();
  }, [visible, status]);

  if (!visible) return null;

  const isError = status === "error";
  const correct = !isError && result?.correct === true;
  const tone = isError
    ? "bg-card border-border-strong text-ink"
    : correct
      ? "bg-ok-bg border-ok text-ok-text"
      : "bg-fire-bg border-fire text-fire-text";

  const title = isError
    ? "Yuborilmadi"
    : correct
      ? result && result.xpAwarded > 0
        ? `Zo'r! +${result.xpAwarded} XP`
        : "Zo'r!"
      : "Deyarli!";

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role={correct ? "status" : "alert"}
      aria-labelledby="feedback-title"
      className={`fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md rounded-t-[var(--radius-xl)] border-t-2 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] outline-none focus-visible:ring-2 focus-visible:ring-info-strong ${tone}`}
    >
      <div className="flex items-center gap-2">
        {!isError && (
          <span aria-hidden="true" className="inline-flex">
            {correct ? <Check className="size-6" /> : <X className="size-6" />}
          </span>
        )}
        <p id="feedback-title" className="text-xl font-extrabold">
          {title}
        </p>
      </div>
      {isError && <p className="mt-1 text-base text-ink-2">{ERROR_TEXT[error ?? "network"]}</p>}
      {!isError && !correct && expectedText && (
        <p className="mt-1 text-base text-ink">
          To&apos;g&apos;ri javob: <span lang="ru" className="font-extrabold">{expectedText}</span>
        </p>
      )}
      {!isError && !correct && hint && <p className="mt-1 text-sm text-ink-2">{hint}</p>}
      <div className="mt-4">
        {isError ? (
          error === "auth" ? (
            <Button fullWidth size="lg" href="/login">
              Qayta kirish
            </Button>
          ) : RETRYABLE.includes(error ?? "network") ? (
            <Button fullWidth size="lg" onClick={onRetry}>
              Qayta urinish
            </Button>
          ) : onExit ? (
            <Button fullWidth size="lg" variant="secondary" onClick={onExit}>
              Orqaga
            </Button>
          ) : null
        ) : (
          <Button fullWidth size="lg" variant={correct ? "success" : "primary"} onClick={onContinue}>
            {correct ? "Davom etish" : "Tushundim"}
          </Button>
        )}
      </div>
    </div>
  );
}
