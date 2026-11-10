"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui";
import type { RuleImagePayload } from "@/lib/blocks/types";
import { useMediaUrl } from "./useMediaUrl";

export interface RuleImageBlockProps {
  blockId: string;
  payload: RuleImagePayload;
  url: string | null;
  onDone: () => void;
}

export function RuleImageBlock({ blockId, payload, url: initialUrl, onDone }: RuleImageBlockProps) {
  const media = useMediaUrl(blockId, initialUrl);
  const [zoom, setZoom] = useState(false);
  const retried = useRef(false);

  // Unavailable media must never trap the student on this block.
  useEffect(() => {
    if (media.state === "unavailable") onDone();
  }, [media.state, onDone]);

  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoom(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [zoom]);

  if (media.state === "unavailable") {
    return (
      <section role="status" className="flex flex-col gap-3 rounded-[var(--radius-lg)] border-2 border-border bg-surface-2 p-4">
        <p className="text-ink-2">Rasm hozircha mavjud emas.</p>
        <Button variant="secondary" onClick={() => void media.refresh()}>
          Qayta urinish
        </Button>
      </section>
    );
  }

  return (
    <figure className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setZoom(true)}
        aria-label="Rasmni kattalashtirish"
        className="relative block w-full overflow-hidden rounded-[var(--radius-lg)] border-2 border-border bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimisable by next/image */}
        <img
          src={media.url ?? undefined}
          alt={payload.alt}
          loading="lazy"
          className="block h-auto w-full"
          onLoad={onDone}
          onError={() => {
            if (retried.current) return media.fail();
            retried.current = true;
            void media.refresh();
          }}
        />
        <span aria-hidden="true" className="absolute right-2 bottom-2 rounded-full bg-card/90 p-2">
          <Maximize2 className="size-5" />
        </span>
      </button>
      {payload.caption && <figcaption className="text-ink-2">{payload.caption}</figcaption>}
      {zoom && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Rasm"
          className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-ink/90 p-4"
          onClick={() => setZoom(false)}
        >
          <div className="fixed top-4 right-4">
            <IconButton aria-label="Yopish" icon={<X className="size-5" />} onClick={() => setZoom(false)} autoFocus />
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={media.url ?? undefined} alt={payload.alt} className="max-h-full max-w-full object-contain" />
        </div>
      )}
    </figure>
  );
}
