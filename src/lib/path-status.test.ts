import { describe, expect, it } from 'vitest'
import { computeLessonStatus, computePathStatus, moduleTestStatus, type PartProgress } from './path-status'

const parts = [
  { id: 'p3', order: 3 },
  { id: 'p1', order: 1 },
  { id: 'p2', order: 2 },
]
const st = (m: [string, PartProgress][]) => Object.fromEntries(computePathStatus(parts, new Map(m)))

describe('computePathStatus', () => {
  it('no progress: first available, rest locked (order-sorted)', () => {
    expect(st([])).toEqual({ p1: 'available', p2: 'locked', p3: 'locked' })
  })
  it('first in progress', () => {
    expect(st([['p1', 'in_progress']])).toEqual({ p1: 'in_progress', p2: 'locked', p3: 'locked' })
  })
  it('first completed, second available', () => {
    expect(st([['p1', 'completed']])).toEqual({ p1: 'completed', p2: 'available', p3: 'locked' })
  })
  it('second in progress', () => {
    expect(st([['p1', 'completed'], ['p2', 'in_progress']])).toEqual({
      p1: 'completed',
      p2: 'in_progress',
      p3: 'locked',
    })
  })
  it('all completed', () => {
    expect(st([['p1', 'completed'], ['p2', 'completed'], ['p3', 'completed']])).toEqual({
      p1: 'completed',
      p2: 'completed',
      p3: 'completed',
    })
  })
  it('later completed without earlier does not unlock', () => {
    expect(st([['p3', 'completed']])).toEqual({ p1: 'available', p2: 'locked', p3: 'locked' })
  })
  it('empty parts', () => {
    expect(computePathStatus([], new Map()).size).toBe(0)
  })
})

describe('computeLessonStatus', () => {
  it('both completed', () => expect(computeLessonStatus(['completed', 'completed'])).toBe('completed'))
  it('in_progress wins', () => expect(computeLessonStatus(['completed', 'in_progress'])).toBe('in_progress'))
  it('available', () => expect(computeLessonStatus(['completed', 'available'])).toBe('available'))
  it('locked', () => expect(computeLessonStatus(['locked', 'locked'])).toBe('locked'))
  it('empty is locked', () => expect(computeLessonStatus([])).toBe('locked'))
})

describe('moduleTestStatus', () => {
  const ten = (s: 'completed' | 'available') => Array.from({ length: 10 }, () => s)
  it('available only when all 10 lessons completed', () => {
    expect(moduleTestStatus(ten('completed'))).toBe('available')
    expect(moduleTestStatus([...ten('completed').slice(1), 'available'])).toBe('locked')
  })
  it('empty is locked', () => expect(moduleTestStatus([])).toBe('locked'))
})
