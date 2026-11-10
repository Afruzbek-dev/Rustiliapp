"use client";

import { useEffect, useRef, useState } from "react";

const BARS = 32;

/** Live level bars from an AnalyserNode. Honors prefers-reduced-motion (slow, step-wise updates). */
export function Waveform({ analyser, active }: { analyser: AnalyserNode | null; active: boolean }) {
  const [levels, setLevels] = useState<number[]>(() => Array.from({ length: BARS }, () => 0.08));
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (!analyser || !active) {
      setLevels(Array.from({ length: BARS }, () => 0.08));
      return;
    }
    const reduced =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
        : false;
    const data = new Uint8Array(analyser.frequencyBinCount || 128);
    const sample = () => {
      analyser.getByteTimeDomainData(data);
      const step = Math.max(1, Math.floor(data.length / BARS));
      const next: number[] = [];
      for (let i = 0; i < BARS; i++) {
        let peak = 0;
        for (let j = 0; j < step; j++) peak = Math.max(peak, Math.abs((data[i * step + j] ?? 128) - 128));
        next.push(Math.min(1, Math.max(0.08, peak / 64)));
      }
      setLevels(next);
    };
    if (reduced) {
      const id = window.setInterval(sample, 400);
      return () => window.clearInterval(id);
    }
    const loop = () => {
      sample();
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [analyser, active]);

  return (
    <div role="img" aria-label="Ovoz to'lqini" className="flex h-16 items-center justify-center gap-[3px]">
      {levels.map((l, i) => (
        <span
          key={i}
          className={`w-[5px] rounded-full ${active ? "bg-ink" : "bg-border-strong"}`}
          style={{ height: `${Math.round(l * 100)}%` }}
        />
      ))}
    </div>
  );
}
