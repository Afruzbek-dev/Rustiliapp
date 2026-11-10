"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui";
import type { AudioPayload } from "@/lib/blocks/types";
import { useMediaUrl } from "./useMediaUrl";

export interface AudioBlockProps {
  blockId: string;
  payload: AudioPayload;
  /** Signed URL from the server; null when the media is unavailable. */
  url: string | null;
  onDone: () => void;
  done?: boolean;
}

const RATES = [1, 0.75] as const;

export function AudioBlock({ blockId, payload, url: initialUrl, onDone, done = false }: AudioBlockProps) {
  const media = useMediaUrl(blockId, initialUrl);
  const ref = useRef<HTMLAudioElement>(null);
  const reported = useRef(false);
  const retried = useRef(false);
  const [rate, setRate] = useState<number>(1);

  // Unavailable media must never trap the student on this block.
  useEffect(() => {
    if (media.state === "unavailable") onDone();
  }, [media.state, onDone]);

  function listened() {
    onDone();
    if (reported.current) return;
    reported.current = true;
    // Daily "audio" task, once per day on the server. Fire and forget.
    void fetch("/api/lesson/audio-listened", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blockId }),
    }).catch(() => undefined);
  }

  function setPlaybackRate(r: number) {
    setRate(r);
    if (ref.current) ref.current.playbackRate = r;
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-extrabold">{payload.title}</h2>
      {media.state === "unavailable" ? (
        <div role="status" className="flex flex-col gap-3 rounded-[var(--radius-lg)] border-2 border-border bg-surface-2 p-4">
          <p className="text-ink-2">Audio hozircha mavjud emas.</p>
          <Button variant="secondary" onClick={() => void media.refresh()}>
            Qayta urinish
          </Button>
        </div>
      ) : (
        <>
          <audio
            ref={ref}
            controls
            preload="metadata"
            src={media.url ?? undefined}
            className="w-full"
            onEnded={listened}
            onError={() => {
              // An expired URL: ask for a fresh one once, else show the unavailable state.
              if (retried.current) return media.fail();
              retried.current = true;
              void media.refresh();
            }}
          />
          <div role="group" aria-label="Tezlik" className="flex gap-2">
            {RATES.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={rate === r}
                onClick={() => setPlaybackRate(r)}
                className={`inline-flex min-h-11 min-w-14 items-center justify-center rounded-[var(--radius-sm)] border-2 px-3 font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong ${
                  rate === r ? "border-ink bg-ink text-bg" : "border-border-strong bg-card text-ink"
                }`}
              >
                {r === 1 ? "1x" : `${r}x`}
              </button>
            ))}
          </div>
          <Button variant={done ? "success" : "secondary"} disabled={done} onClick={listened}>
            {done && <Check className="size-5" aria-hidden="true" />}
            {done ? "Eshitildi" : "Eshitdim"}
          </Button>
        </>
      )}
      {payload.transcript && (
        <details className="rounded-[var(--radius-md)] border-2 border-border bg-card p-3">
          <summary className="min-h-11 cursor-pointer py-2 font-bold">Matn (transkript)</summary>
          <p lang="ru" className="mt-2 whitespace-pre-line text-lg leading-relaxed">
            {payload.transcript}
          </p>
        </details>
      )}
    </section>
  );
}
