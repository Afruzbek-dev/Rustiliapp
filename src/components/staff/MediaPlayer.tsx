"use client";

import { Pause, Play, RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/ui";

const SPEEDS = [1, 1.25, 1.5] as const;

function clock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

type Load = { state: "loading" } | { state: "error" } | { state: "ready"; url: string };

function AudioPlayer({ submissionId }: { submissionId: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/submissions/audio-url?id=${encodeURIComponent(submissionId)}`, {
          cache: "no-store",
        });
        const body = res.ok ? ((await res.json()) as { url?: unknown }) : null;
        if (cancelled) return;
        setLoad(body && typeof body.url === "string" ? { state: "ready", url: body.url } : { state: "error" });
      } catch {
        if (!cancelled) setLoad({ state: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [submissionId, attempt]);

  const toggle = useCallback(() => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void Promise.resolve(el.play()).catch(() => setPlaying(false));
    else el.pause();
  }, []);

  function pickSpeed(s: (typeof SPEEDS)[number]) {
    setSpeed(s);
    if (audio.current) audio.current.playbackRate = s;
  }

  if (load.state === "loading") {
    return (
      <p role="status" className="rounded-[var(--radius-md)] bg-surface-2 p-4 text-ink-2">
        Audio yuklanmoqda
      </p>
    );
  }
  if (load.state === "error") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] bg-fire-bg p-4 text-fire-text">
        <p role="alert" className="font-bold">
          Audioni yuklab bo&apos;lmadi
        </p>
        <IconButton
          aria-label="Audioni qayta yuklash"
          icon={<RotateCw className="size-5" />}
          onClick={() => {
            setLoad({ state: "loading" });
            setAttempt((n) => n + 1);
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-md)] bg-surface-2 p-3">
      <audio
        ref={audio}
        src={load.url}
        preload="metadata"
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration);
          e.currentTarget.playbackRate = speed;
        }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setLoad({ state: "error" })}
      />
      <div className="flex items-center gap-3">
        <IconButton
          aria-label={playing ? "To'xtatish" : "Eshitish"}
          icon={playing ? <Pause className="size-6" /> : <Play className="size-6" />}
          onClick={toggle}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <input
            type="range"
            aria-label="Audio o'rni"
            min={0}
            max={Number.isFinite(duration) && duration > 0 ? duration : 0}
            step={0.1}
            value={Math.min(time, Number.isFinite(duration) ? duration : 0)}
            onChange={(e) => {
              const v = Number(e.target.value);
              setTime(v);
              if (audio.current) audio.current.currentTime = v;
            }}
            className="h-6 w-full accent-[var(--ink)]"
          />
          <p className="text-sm text-ink-2" aria-hidden="true">
            {clock(time)} / {clock(duration)}
          </p>
        </div>
      </div>
      <div role="group" aria-label="Tezlik" className="flex gap-2">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={speed === s}
            onClick={() => pickSpeed(s)}
            className={`min-h-11 flex-1 rounded-[var(--radius-sm)] border-2 px-3 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong ${
              speed === s ? "border-ink bg-ink text-bg" : "border-border-strong bg-card text-ink"
            }`}
          >
            {s}x
          </button>
        ))}
      </div>
    </div>
  );
}

/** Audio: signed URL (10 minutes) fetched per submission; video: the authorised Telegram proxy with native controls. */
export function MediaPlayer({ submissionId, kind }: { submissionId: string; kind: "audio" | "video" }) {
  if (kind === "video") {
    return (
      <video
        controls
        playsInline
        preload="metadata"
        src={`/api/media/tg/${submissionId}`}
        aria-label="Video topshiriq"
        className="aspect-video w-full rounded-[var(--radius-md)] bg-ink"
      />
    );
  }
  return <AudioPlayer submissionId={submissionId} />;
}
