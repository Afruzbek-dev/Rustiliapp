"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, ListChecks, RotateCcw, Target } from "lucide-react";
import { Button, Card } from "@/components/ui";

export type StartAction = (input: { testId: string }) => Promise<{ ok: true } | { ok: false; code: string }>;

const MESSAGES: Record<string, string> = {
  locked: "Avval modul darslarini tugating.",
  limit: "Urinishlar tugagan.",
  passed: "Siz bu testdan allaqachon o'tgansiz.",
  no_items: "Test hali tayyor emas.",
  not_found: "Test topilmadi.",
};
export const startErrorMessage = (code: string): string => MESSAGES[code] ?? "Xatolik yuz berdi, qayta urinib ko'ring.";

/** Starts the attempt; the page then re-renders with the questions. */
export function StartButton({
  testId,
  start,
  label = "Testni boshlash",
  variant = "primary",
  onStarted,
}: {
  testId: string;
  start: StartAction;
  label?: string;
  variant?: "primary" | "secondary";
  onStarted?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const res = await start({ testId });
      if (res.ok) {
        if (onStarted) onStarted();
        else router.refresh();
        return;
      }
      setError(startErrorMessage(res.code));
    } catch {
      setError(startErrorMessage("failed"));
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <Button size="lg" variant={variant} fullWidth loading={busy} disabled={busy} onClick={() => void go()}>
        {label}
      </Button>
      {error && (
        <p role="alert" className="font-bold text-fire-text">
          {error}
        </p>
      )}
    </div>
  );
}

export interface TestIntroProps {
  testId: string;
  title: string;
  itemCount: number;
  timeLimitMin: number | null;
  passScore: number | null;
  maxAttempts: number;
  start: StartAction;
}

export function TestIntro({ testId, title, itemCount, timeLimitMin, passScore, maxAttempts, start }: TestIntroProps) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 p-4">
      <h1 className="text-2xl font-extrabold">{title}</h1>
      {itemCount === 0 ? (
        <Card tone="muted">
          <p className="font-bold">Test hali tayyor emas.</p>
        </Card>
      ) : (
        <>
          <Card>
            <ul className="flex flex-col gap-3 font-bold">
              <li className="flex items-center gap-3">
                <ListChecks className="size-5 shrink-0 text-ink-2" aria-hidden="true" />
                {itemCount} ta mashq
              </li>
              <li className="flex items-center gap-3">
                <Clock className="size-5 shrink-0 text-ink-2" aria-hidden="true" />
                {timeLimitMin === null ? "Vaqt cheklanmagan" : `${timeLimitMin} daqiqa`}
              </li>
              {passScore !== null && (
                <li className="flex items-center gap-3">
                  <Target className="size-5 shrink-0 text-ink-2" aria-hidden="true" />
                  O&apos;tish bali: {passScore}%
                </li>
              )}
              <li className="flex items-center gap-3">
                <RotateCcw className="size-5 shrink-0 text-ink-2" aria-hidden="true" />
                {maxAttempts === 1 ? "Faqat bitta urinish" : `${maxAttempts} tagacha urinish`}
              </li>
            </ul>
          </Card>
          <p className="text-ink-2">
            Javoblar test oxirida tekshiriladi. Natija va xatolar tahlili testni yakunlagandan keyin ko&apos;rsatiladi.
          </p>
          <StartButton testId={testId} start={start} />
        </>
      )}
    </main>
  );
}
