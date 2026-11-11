"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";
import { Button, ErrorState } from "@/components/ui";
import { UNSUPPORTED_BLOCK_TEXT } from "@/lib/blocks/types";
import type { LessonPartData } from "@/server/lesson";
import { AudioBlock } from "./blocks/AudioBlock";
import { ExerciseBlock } from "./blocks/ExerciseBlock";
import { RuleImageBlock } from "./blocks/RuleImageBlock";
import { SpeakingBlock } from "./blocks/SpeakingBlock";
import { TextBlock } from "./blocks/TextBlock";
import { VideoBlock } from "./blocks/VideoBlock";
import { WordsBlock } from "./blocks/WordsBlock";
import { PartDone } from "./PartDone";

export interface LessonPlayerProps {
  data: LessonPartData;
  /** Signed media URLs by block id (null = unavailable). */
  media: Record<string, string | null>;
  /**
   * First block to show. Position lives only in component state (no storage): a fresh visit starts
   * at block 1; the page passes a later index only to resume after a submitted speaking block
   * (the student leaves the player for /speak and comes back).
   */
  initialIndex?: number;
}

type MissingItem = { exerciseId: string; kind: "exercise" | "speaking" };
type Phase =
  | { kind: "blocks" }
  | { kind: "completing" }
  | { kind: "error"; auth: boolean }
  | { kind: "missing"; items: MissingItem[] }
  | { kind: "done"; xp: number };

export function LessonPlayer({ data, media, initialIndex = 0 }: LessonPlayerProps) {
  const router = useRouter();
  const total = data.blocks.length;
  const [index, setIndex] = useState(() => Math.min(Math.max(0, Math.floor(initialIndex)), Math.max(0, total - 1)));
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set());
  const [phase, setPhase] = useState<Phase>({ kind: "blocks" });
  // Set when the student came back from the "missing" screen: after that block, go straight to finishing.
  const [returning, setReturning] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  // Move focus to the new block's heading (or the container) so keyboard / screen reader users land on it.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const main = mainRef.current;
    if (!main) return;
    const target = (main.querySelector("h1, h2") as HTMLElement | null) ?? main;
    target.tabIndex = -1;
    target.focus();
  }, [index, phase.kind]);

  const block = data.blocks[index];
  const blockId = block?.id ?? "";
  // Stable per block so blocks can safely use it in effects. Idempotent: no re-render when already done.
  const markDone = useCallback(() => {
    setDone((prev) => (prev.has(blockId) ? prev : new Set(prev).add(blockId)));
  }, [blockId]);
  const exit = useCallback(() => router.push("/path"), [router]);

  const isLast = index === total - 1;
  const canNext = done.has(blockId);

  const finish = useCallback(async () => {
    setPhase({ kind: "completing" });
    try {
      const res = await fetch("/api/lesson/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ partId: data.part.id }),
      });
      if (!res.ok) {
        setPhase({ kind: "error", auth: res.status === 401 });
        return;
      }
      const body = (await res.json()) as {
        completed?: boolean;
        newlyCompleted?: boolean;
        xpAwarded?: number;
        missing?: MissingItem[];
      };
      if (body.completed === true) {
        // Only claim XP this request actually granted.
        const earned = body.newlyCompleted === true || (body.xpAwarded ?? 0) > 0 ? body.xpAwarded || 0 : 0;
        setPhase({ kind: "done", xp: earned });
      } else {
        setPhase({ kind: "missing", items: Array.isArray(body.missing) ? body.missing : [] });
      }
    } catch {
      setPhase({ kind: "error", auth: false });
    }
  }, [data.part.id]);

  if (!block) {
    return <ErrorState title="Dars bo'sh" text="Bu darsda hali bloklar yo'q." action={<Button href="/path">Yo&apos;lga qaytish</Button>} />;
  }

  if (phase.kind === "done") return <PartDone xp={phase.xp} nextPartId={data.nextPartId} />;

  if (phase.kind === "completing") {
    return (
      <div role="status" className="flex min-h-dvh items-center justify-center p-6 text-ink-2">
        Natija tekshirilmoqda...
      </div>
    );
  }

  if (phase.kind === "error") {
    return (
      <ErrorState
        title="Darsni yakunlab bo'lmadi"
        text={phase.auth ? "Seans tugagan. Qayta kiring." : "Ulanishni tekshirib, qayta urinib ko'ring."}
        action={
          phase.auth ? (
            <Button href="/login">Qayta kirish</Button>
          ) : (
            <Button onClick={() => void finish()}>Qayta urinish</Button>
          )
        }
      />
    );
  }

  if (phase.kind === "missing") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-4">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold">
          <AlertTriangle className="size-6 text-fire-text" aria-hidden="true" />
          Dars hali tugamadi
        </h1>
        {phase.items.length === 0 ? (
          <p className="text-ink-2">Dars tugashi uchun yetarli mashq topilmadi. Yo&apos;lga qaytib, keyinroq urinib ko&apos;ring.</p>
        ) : (
          <>
            <p className="text-ink-2">Quyidagi mashqlarni bajaring, keyin darsni qayta yakunlang:</p>
            <ul className="flex flex-col gap-3">
              {phase.items.map((m, i) => {
                const at = data.blocks.findIndex(
                  (b) => (b.type === "exercise" || b.type === "speaking") && b.payload.exerciseId === m.exerciseId,
                );
                const label = m.kind === "speaking" ? "Gapirish topshirig'i" : "Mashq";
                return (
                  <li key={`${m.exerciseId}:${i}`}>
                    {m.kind === "speaking" ? (
                      <Button variant="secondary" fullWidth href={`/speak/${m.exerciseId}`}>
                        {label}: bajarish
                      </Button>
                    ) : at >= 0 ? (
                      <Button
                        variant="secondary"
                        fullWidth
                        onClick={() => {
                          setIndex(at);
                          setReturning(true);
                          setPhase({ kind: "blocks" });
                        }}
                      >
                        {at + 1}-blok: {label.toLowerCase()}ni qayta bajarish
                      </Button>
                    ) : (
                      <p className="text-ink-2">{label} topilmadi.</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <Button variant="secondary" href="/path">
          Yo&apos;lga qaytish
        </Button>
      </main>
    );
  }

  const exercise = (id: string) => data.exercises[id];

  let body: ReactNode;
  switch (block.type) {
    case "video":
      body = <VideoBlock key={block.id} payload={block.payload} done={canNext} onDone={markDone} />;
      break;
    case "audio":
      body = (
        <AudioBlock key={block.id} blockId={block.id} payload={block.payload} url={media[block.id] ?? null} done={canNext} onDone={markDone} />
      );
      break;
    case "rule_image":
      body = <RuleImageBlock key={block.id} blockId={block.id} payload={block.payload} url={media[block.id] ?? null} onDone={markDone} />;
      break;
    case "text":
    case "reading":
      body = <TextBlock key={block.id} payload={block.payload} words={data.words} done={canNext} onDone={markDone} />;
      break;
    case "words":
      body = <WordsBlock key={block.id} words={data.words} lessonId={data.lesson.id} onDone={markDone} />;
      break;
    case "exercise":
      body = <ExerciseBlock key={block.id} exercise={exercise(block.payload.exerciseId)} onDone={markDone} onExit={exit} />;
      break;
    case "speaking":
      body = (
        <SpeakingBlock
          key={block.id}
          exercise={exercise(block.payload.exerciseId)}
          submitted={data.submittedExerciseIds.includes(block.payload.exerciseId)}
          done={canNext}
          onDone={markDone}
        />
      );
      break;
    default:
      body = <UnsupportedBlock key={block.id} onDone={markDone} />;
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <header className="sticky top-0 z-30 flex items-center gap-3 bg-bg px-4 py-3">
        <Link
          href="/path"
          aria-label="Darsni yopish"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border-2 border-border-strong bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong"
        >
          <X aria-hidden="true" className="size-5" />
        </Link>
        <div
          role="progressbar"
          aria-label="Dars jarayoni"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={index + 1}
          className="h-3 flex-1 overflow-hidden rounded-full bg-surface-2"
        >
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-150 motion-reduce:transition-none"
            style={{ width: `${((index + 1) / total) * 100}%` }}
          />
        </div>
        <span className="shrink-0 text-sm font-bold text-ink-2" aria-label={`${index + 1}-blok, jami ${total}`}>
          {index + 1}/{total}
        </span>
      </header>

      <main ref={mainRef} className="flex-1 px-4 pt-2 pb-28">{body}</main>

      <footer className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md border-t-2 border-border bg-bg px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button
          fullWidth
          size="lg"
          disabled={!canNext}
          onClick={() => {
            if (isLast || returning) void finish();
            else setIndex(index + 1);
          }}
        >
          {isLast || returning ? "Tugatish" : "Keyingisi"}
        </Button>
      </footer>
    </div>
  );
}

function UnsupportedBlock({ onDone }: { onDone: () => void }) {
  // Unknown blocks never trap the student.
  useEffect(() => {
    onDone();
  }, [onDone]);
  return (
    <p role="status" className="rounded-[var(--radius-lg)] border-2 border-border bg-surface-2 p-4 text-ink-2">
      {UNSUPPORTED_BLOCK_TEXT}
    </p>
  );
}
