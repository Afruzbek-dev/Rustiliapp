"use client";

import { useState } from "react";
import { cn } from "@/components/ui/cn";

export interface ActivityPoint {
  /** YYYY-MM-DD */
  day: string;
  active: number;
}

const MONTHS = ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avg", "sen", "okt", "noy", "dek"];

/** "2026-11-09" -> "9 noy". */
export function formatDay(day: string): string {
  const [, m, d] = day.split("-");
  const month = MONTHS[Number(m) - 1];
  return month ? `${Number(d)} ${month}` : day;
}

/** Top of the y axis: a round number >= max (4, 10, 20, 50, 100, then multiples of 100). */
export function niceTop(max: number): number {
  for (const t of [4, 10, 20, 50, 100]) if (max <= t) return t;
  return Math.ceil(max / 100) * 100;
}

export interface ActivityChartProps {
  data: ActivityPoint[];
}

/**
 * One series (active students per day), a single colour (--info = #3D7BEA), thin 12px marks with 4px
 * rounded data ends, a recessive grid and ink text. Every bar is a <button> with an aria-label; hover
 * or focus shows a tooltip; the same numbers are available as a table inside <details>.
 */
export function ActivityChart({ data }: ActivityChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const top = niceTop(Math.max(0, ...data.map((d) => d.active)));
  const ticks = [top, top / 2, 0];

  return (
    <figure className="flex flex-col gap-3">
      <div className="flex gap-2">
        <div aria-hidden="true" className="mt-10 flex h-44 flex-col justify-between text-right text-xs text-ink-3">
          {ticks.map((t) => (
            <span key={t} className="leading-none">
              {t}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto">
          <div className="relative min-w-[616px] pt-10">
            <div className="relative h-44">
              {[0, 50, 100].map((p) => (
                <div
                  key={p}
                  aria-hidden="true"
                  className="absolute inset-x-0 border-t border-border"
                  style={{ top: `${p}%` }}
                />
              ))}
              <div className="absolute inset-0 flex items-end">
                {data.map((d, i) => {
                  const label = `${formatDay(d.day)}: ${d.active} ta faol o'quvchi`;
                  const shown = activeIndex === i;
                  return (
                    <button
                      key={d.day}
                      type="button"
                      aria-label={label}
                      aria-describedby={shown ? "activity-tooltip" : undefined}
                      onMouseEnter={() => setActiveIndex(i)}
                      onMouseLeave={() => setActiveIndex((c) => (c === i ? null : c))}
                      onFocus={() => setActiveIndex(i)}
                      onBlur={() => setActiveIndex((c) => (c === i ? null : c))}
                      className="relative flex h-full min-w-11 flex-1 items-end justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong"
                    >
                      <span
                        aria-hidden="true"
                        className={cn("block w-3 rounded-t-[4px] bg-info", shown && "opacity-80")}
                        style={{ height: `${(d.active / top) * 100}%` }}
                      />
                      {shown && (
                        <span
                          id="activity-tooltip"
                          role="tooltip"
                          className={cn(
                            "pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-[var(--radius-sm)] bg-ink px-2 py-1 text-xs font-bold text-card",
                            i < 2 ? "left-0" : i >= data.length - 2 ? "right-0" : "left-1/2 -translate-x-1/2",
                          )}
                        >
                          {label}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            <div aria-hidden="true" className="flex pt-1">
              {data.map((d) => (
                <span key={d.day} className="min-w-11 flex-1 text-center text-xs text-ink-3">
                  {formatDay(d.day)}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <details className="rounded-[var(--radius-md)] border-2 border-border bg-card">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-bold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong">
          Jadval ko&apos;rinishi
        </summary>
        <div className="overflow-x-auto px-3 pb-3">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Kunlik faol o&apos;quvchilar</caption>
            <thead>
              <tr className="text-ink-2">
                <th scope="col" className="py-1 pr-4 font-bold">
                  Kun
                </th>
                <th scope="col" className="py-1 font-bold">
                  Faol o&apos;quvchilar
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.day} className="border-t border-border text-ink">
                  <th scope="row" className="py-1 pr-4 font-normal">
                    {formatDay(d.day)}
                  </th>
                  <td className="py-1">{d.active}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
