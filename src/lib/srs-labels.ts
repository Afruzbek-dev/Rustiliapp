import { grade, type SrsCard, type SrsGrade } from "./srs";

export type IntervalLabels = Record<SrsGrade, string>;

/** Uzbek label of an interval: minutes below an hour, days up to two months, then months. */
export function intervalLabel(from: Date, to: Date): string {
  const minutes = Math.round((to.getTime() - from.getTime()) / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} daq`;
  const days = Math.round(minutes / 1440);
  if (days < 1) return `${Math.round(minutes / 60)} soat`;
  if (days < 60) return `${days} kun`;
  return `${Math.round(days / 30)} oy`;
}

/** What each grade button promises, computed with the real srs.grade (never duplicated rules). */
export function nextIntervalLabels(card: SrsCard, now: Date): IntervalLabels {
  const label = (g: SrsGrade) => intervalLabel(now, grade(card, g, now).due);
  return { again: label("again"), hard: label("hard"), good: label("good") };
}
