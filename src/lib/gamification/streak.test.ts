import { describe, expect, it } from 'vitest'
import { currentStreak } from './streak'

describe('currentStreak', () => {
  it('empty', () => expect(currentStreak([], '2026-11-10')).toBe(0))
  it('today + yesterday + day before', () =>
    expect(currentStreak(['2026-11-10', '2026-11-09', '2026-11-08'], '2026-11-10')).toBe(3))
  it('only yesterday', () => expect(currentStreak(['2026-11-09'], '2026-11-10')).toBe(1))
  it('no yesterday, older day exists', () =>
    expect(currentStreak(['2026-11-08'], '2026-11-10')).toBe(0))
  it('unsorted, duplicates, gap ends the run', () =>
    expect(
      currentStreak(['2026-11-08', '2026-11-10', '2026-11-10', '2026-11-09', '2026-11-06'], '2026-11-10'),
    ).toBe(3))
  it('crosses month/year boundaries', () =>
    expect(currentStreak(['2027-01-01', '2026-12-31', '2026-12-30'], '2027-01-01')).toBe(3))
  it('today only', () => expect(currentStreak(['2026-11-10'], '2026-11-10')).toBe(1))
})
