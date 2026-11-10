"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui";
import type { VideoPayload } from "@/lib/blocks/types";

export interface VideoBlockProps {
  payload: VideoPayload;
  onDone: () => void;
  done?: boolean;
}

/** YouTube via the privacy-enhanced domain: lazy, no autoplay, 16:9. "Ko'rdim" unlocks after the player loaded. */
export function VideoBlock({ payload, onDone, done = false }: VideoBlockProps) {
  const [loaded, setLoaded] = useState(false);
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
      <Button variant={done ? "success" : "secondary"} disabled={!loaded || done} onClick={onDone}>
        {done && <Check className="size-5" aria-hidden="true" />}
        {done ? "Ko'rildi" : loaded ? "Ko'rdim" : "Video yuklanmoqda"}
      </Button>
    </section>
  );
}
