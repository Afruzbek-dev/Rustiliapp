"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui";
import type { VideoPayload } from "@/lib/blocks/types";

export const VIDEO_LOAD_TIMEOUT_MS = 8000;

export interface VideoBlockProps {
  payload: VideoPayload;
  onDone: () => void;
  done?: boolean;
}

/** YouTube via the privacy-enhanced domain: lazy, no autoplay, 16:9. "Ko'rdim" unlocks after the player loaded. */
export function VideoBlock({ payload, onDone, done = false }: VideoBlockProps) {
  const [loaded, setLoaded] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  // Offline or blocked YouTube never fires `load`: after a while let the student move on.
  useEffect(() => {
    if (loaded) return;
    const t = setTimeout(() => setTimedOut(true), VIDEO_LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [loaded]);
  const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(payload.videoId)}?rel=0&modestbranding=1`;
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-extrabold">{payload.title}</h2>
      <div className="aspect-video w-full overflow-hidden rounded-[var(--radius-lg)] border-2 border-border bg-surface-2">
        <iframe
          title={payload.title}
          src={src}
          loading="lazy"
          allow="encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="size-full border-0"
          onLoad={() => setLoaded(true)}
        />
      </div>
      {!loaded && timedOut && !done ? (
        <Button variant="secondary" onClick={onDone}>
          Videoni ochib bo&apos;lmadi, davom etish
        </Button>
      ) : (
        <Button variant={done ? "success" : "secondary"} disabled={!loaded || done} onClick={onDone}>
          {done && <Check className="size-5" aria-hidden="true" />}
          {done ? "Ko'rildi" : loaded ? "Ko'rdim" : "Video yuklanmoqda"}
        </Button>
      )}
    </section>
  );
}
