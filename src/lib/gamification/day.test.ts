import { describe, expect, it } from 'vitest'
import { tashkentDay } from './day'

describe('tashkentDay', () => {
  it('uses UTC+5', () => {
    expect(tashkentDay(new Date('2026-11-10T12:00:00Z'))).toBe('2026-11-10')
  })
  it('day boundary at 19:00 UTC', () => {
    expect(tashkentDay(new Date('2026-11-10T18:59:59Z'))).toBe('2026-11-10')
    expect(tashkentDay(new Date('2026-11-10T19:00:00Z'))).toBe('2026-11-11')
  })
  it('crosses year and month', () => {
    expect(tashkentDay(new Date('2026-12-31T19:00:00Z'))).toBe('2027-01-01')
    expect(tashkentDay(new Date('2028-02-28T20:00:00Z'))).toBe('2028-02-29')
  })
})
