const DAY_MS = 86_400_000
const toMs = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/**
 * Consecutive active days ending today; if today has no activity,
 * counting starts from yesterday (streak is still alive).
 */
export function currentStreak(days: string[], today: string): number {
  const set = new Set(days)
  let cursor = toMs(today)
  if (!set.has(today)) cursor -= DAY_MS
  let n = 0
  while (set.has(new Date(cursor).toISOString().slice(0, 10))) {
    n++
    cursor -= DAY_MS
  }
  return n
}
