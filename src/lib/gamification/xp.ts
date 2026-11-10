export const EXERCISE_FIRST = 10
export const EXERCISE_RETRY = 5
export const PART_COMPLETED = 20
export const DAILY_TASKS = 30
export const STREAK_BONUS: Record<number, number> = { 7: 50, 14: 100, 30: 200 }

export const speakingXp = (total: number): number => Math.round((40 * total) / 5)
export const testXp = (percent: number): number => Math.round(percent * 2)
