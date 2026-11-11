import type { ReactNode } from "react";
import { Check, Clock, Trophy, X, XCircle } from "lucide-react";
import { Button, Card, Chip, ProgressBar } from "@/components/ui";
import type { ResultView } from "@/server/tests";

/** Result screen: only rendered for a FINISHED attempt. Pure view, no hooks. */
export function TestResult({ title, result, retake }: { title: string; result: ResultView; retake?: ReactNode }) {
  const Icon = result.passed ? Trophy : XCircle;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 p-4 pb-10">
      <h1 className="text-lg font-extrabold text-ink-2">{title}</h1>

      <Card>
        <div className="flex flex-col items-center gap-2 text-center">
          <Icon className={`size-12 ${result.passed ? "text-ok-text" : "text-fire-text"}`} aria-hidden="true" />
          <p className="text-xl font-extrabold">{result.passed ? "Test topshirildi" : "Test topshirilmadi"}</p>
          <p className="text-5xl font-extrabold tabular-nums" aria-label={`Umumiy ball: ${result.score} foiz`}>
            {result.score}%
          </p>
          {result.passScore !== null && <p className="text-ink-2">O&apos;tish bali: {result.passScore}%</p>}
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            <Chip tone="ok">
              <Check className="size-4" aria-hidden="true" />
              {result.correct} ta to&apos;g&apos;ri
            </Chip>
            <Chip tone="fire">
              <X className="size-4" aria-hidden="true" />
              {result.wrong} ta xato
            </Chip>
            {result.xp > 0 && <Chip tone="brand">+{result.xp} XP</Chip>}
          </div>
          {result.timedOut && (
            <p className="mt-1 flex items-center gap-1 text-ink-2">
              <Clock className="size-4" aria-hidden="true" />
              Vaqt tugadi: saqlangan javoblar tekshirildi.
            </p>
          )}
        </div>
      </Card>

      {result.sections.length > 0 && (
        <section aria-labelledby="sections-h" className="flex flex-col gap-3">
          <h2 id="sections-h" className="text-lg font-extrabold">
            Bo&apos;limlar bo&apos;yicha
          </h2>
          {result.sections.map((s) => (
            <div key={s.section} className="flex flex-col gap-1">
              <div className="flex justify-between font-bold">
                <span>{s.label}</span>
                <span className="tabular-nums">
                  {s.percent}% ({s.correct}/{s.total})
                </span>
              </div>
              <ProgressBar value={s.percent} color={s.percent >= 50 ? "ok" : "fire"} label={`${s.label}: ${s.percent} foiz`} />
            </div>
          ))}
        </section>
      )}

      {result.recommendations.length > 0 && (
        <section aria-labelledby="rec-h" className="flex flex-col gap-3">
          <h2 id="rec-h" className="text-lg font-extrabold">
            Tavsiyalar
          </h2>
          <ul className="flex flex-col gap-3">
            {result.recommendations.map((r) => (
              <li key={r.section}>
                <Card tone="muted">
                  <p className="font-bold">
                    {r.label} ({r.percent}%)
                  </p>
                  <p>
                    {r.lessons.length > 0 ? (
                      <>
                        Qayta ko&apos;ring: <span lang="ru">{r.lessons.map((l) => l.title).join(", ")}</span>
                      </>
                    ) : (
                      "Bu bo'lim darslarini qayta ko'rib chiqing."
                    )}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.review.length > 0 && (
        <section aria-labelledby="review-h" className="flex flex-col gap-3">
          <h2 id="review-h" className="text-lg font-extrabold">
            Xatolar tahlili
          </h2>
          {!result.answersRevealed && (
            <p className="text-ink-2">To&apos;g&apos;ri javoblar urinishlar tugagandan keyin ko&apos;rsatiladi.</p>
          )}
          <div className="flex flex-col gap-3">
            {result.review.map((r, i) => (
              <details key={r.exerciseId} className="rounded-[var(--radius-lg)] border-2 border-border bg-card p-4">
                <summary className="min-h-11 cursor-pointer font-bold">
                  {i + 1}. {r.prompt ?? "Mashq"}
                </summary>
                <ul className="mt-3 flex flex-col gap-3">
                  {r.lines.map((l, j) => (
                    <li key={j} className="flex gap-2">
                      {l.ok ? (
                        <Check className="mt-1 size-5 shrink-0 text-ok-text" aria-label="To'g'ri" />
                      ) : (
                        <X className="mt-1 size-5 shrink-0 text-fire-text" aria-label="Xato" />
                      )}
                      <div>
                        <p lang="ru" className="font-bold">
                          {l.question}
                        </p>
                        <p className="text-ink-2">
                          Sizning javobingiz: <span lang="ru">{l.yours}</span>
                        </p>
                        {!l.ok && l.expected !== null && (
                          <p className="font-bold text-ok-text">
                            To&apos;g&apos;ri javob: <span lang="ru">{l.expected}</span>
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </section>
      )}

      <p className="text-ink-2">
        {result.attemptsLeft > 0 && !result.passed
          ? `Yana ${result.attemptsLeft} ta urinish qoldi.`
          : result.passed
            ? "Siz bu testdan o'tdingiz."
            : "Urinishlar tugadi."}
      </p>
      {result.canRetake && retake}
      <Button variant="secondary" href="/path">
        O&apos;quv yo&apos;liga qaytish
      </Button>
    </main>
  );
}
