export type SrsCard = {
  interval_days: number
  ease: number
  reps: number
  lapses: number
  due: Date
}
export type SrsGrade = 'again' | 'hard' | 'good'

const MIN_EASE = 1.3
const DAY_MS = 86_400_000

export function newCard(now: Date): SrsCard {
  return { interval_days: 0, ease: 2.5, reps: 0, lapses: 0, due: now }
}

export function grade(card: SrsCard, g: SrsGrade, now: Date): SrsCard {
  const inDays = (n: number) => new Date(now.getTime() + n * DAY_MS)
  switch (g) {
    case 'again':
      return {
        ...card,
        due: new Date(now.getTime() + 10 * 60_000),
        reps: 0,
        lapses: card.lapses + 1,
        ease: Math.max(MIN_EASE, card.ease - 0.2),
      }
    case 'hard': {
      const interval = Math.max(1, Math.round(card.interval_days * 1.2))
      return {
        ...card,
        interval_days: interval,
        ease: Math.max(MIN_EASE, card.ease - 0.15),
        due: inDays(interval),
      }
    }
    case 'good': {
      const interval =
        card.reps === 0 ? 1 : card.reps === 1 ? 4 : Math.round(card.interval_days * card.ease)
      return { ...card, interval_days: interval, reps: card.reps + 1, due: inDays(interval) }
    }
  }
}
