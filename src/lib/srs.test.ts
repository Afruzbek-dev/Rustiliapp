import { describe, expect, it } from 'vitest'
import { grade, newCard } from './srs'

const now = new Date('2026-11-10T10:00:00Z')
const DAY = 86_400_000

describe('srs', () => {
  it('new card defaults', () => {
    expect(newCard(now)).toMatchObject({ interval_days: 0, ease: 2.5, reps: 0, lapses: 0 })
  })
  it('good progression 1 -> 4 -> 10 days', () => {
    const c1 = grade(newCard(now), 'good', now)
    expect(c1.interval_days).toBe(1)
    expect(c1.due.getTime()).toBe(now.getTime() + DAY)
    const c2 = grade(c1, 'good', now)
    expect(c2.interval_days).toBe(4)
    const c3 = grade(c2, 'good', now)
    expect(c3.interval_days).toBe(10)
    expect(c3.reps).toBe(3)
    expect(c3.due.getTime()).toBe(now.getTime() + 10 * DAY)
  })
  it('again resets reps, adds lapse, due in 10 min', () => {
    const c = grade({ ...newCard(now), reps: 3, interval_days: 10 }, 'again', now)
    expect(c.reps).toBe(0)
    expect(c.lapses).toBe(1)
    expect(c.ease).toBeCloseTo(2.3)
    expect(c.due.getTime()).toBe(now.getTime() + 600_000)
  })
  it('ease never below 1.3', () => {
    let c = newCard(now)
    for (let i = 0; i < 20; i++) c = grade(c, 'again', now)
    expect(c.ease).toBe(1.3)
    let h = newCard(now)
    for (let i = 0; i < 20; i++) h = grade(h, 'hard', now)
    expect(h.ease).toBe(1.3)
  })
  it('hard: interval at least 1, x1.2, ease -0.15', () => {
    const c = grade(newCard(now), 'hard', now)
    expect(c.interval_days).toBe(1)
    expect(c.ease).toBeCloseTo(2.35)
    expect(c.due.getTime()).toBe(now.getTime() + DAY)
    expect(grade({ ...c, interval_days: 10 }, 'hard', now).interval_days).toBe(12)
  })
  it('does not mutate input', () => {
    const c = newCard(now)
    grade(c, 'good', now)
    expect(c.reps).toBe(0)
  })
})
