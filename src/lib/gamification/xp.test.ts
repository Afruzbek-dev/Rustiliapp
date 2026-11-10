import { describe, expect, it } from 'vitest'
import * as xp from './xp'

describe('xp', () => {
  it('constants', () => {
    expect(xp.EXERCISE_FIRST).toBe(10)
    expect(xp.EXERCISE_RETRY).toBe(5)
    expect(xp.PART_COMPLETED).toBe(20)
    expect(xp.DAILY_TASKS).toBe(30)
    expect(xp.STREAK_BONUS).toEqual({ 7: 50, 14: 100, 30: 200 })
  })
  it('speakingXp', () => {
    expect(xp.speakingXp(5)).toBe(40)
    expect(xp.speakingXp(0)).toBe(0)
    expect(xp.speakingXp(3)).toBe(24)
    expect(xp.speakingXp(4.5)).toBe(36)
  })
  it('testXp', () => {
    expect(xp.testXp(100)).toBe(200)
    expect(xp.testXp(0)).toBe(0)
    expect(xp.testXp(72.5)).toBe(145)
  })
})
