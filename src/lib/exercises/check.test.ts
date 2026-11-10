import { describe, expect, it } from 'vitest'
import { check } from './check'
import { normalize } from './normalize'
import type { ExerciseType } from './types'

describe('normalize', () => {
  it('trims, collapses spaces, lowercases, strips punctuation', () => {
    expect(normalize('  Гуляет.  ')).toBe('гуляет')
    expect(normalize('Он   идёт!')).toBe('он идет')
    expect(normalize('что?')).toBe('что')
  })
  it('handles decomposed ё and й (NFC first)', () => {
    expect(normalize('Он иде\u0308т')).toBe('он идет')
    expect(normalize('мои\u0306')).toBe(normalize('мой'))
    expect(normalize('мои\u0306')).toBe('мой')
    expect(normalize('ее\u0308')).toBe('ее')
  })
  it('removes stress mark and handles empty', () => {
    expect(normalize('работает́')).toBe('работает')
    expect(normalize('')).toBe('')
  })
})

describe('classify', () => {
  const key = { тетрадь: 'f' }
  it('correct', () => {
    expect(check('classify', key, { itemId: 'тетрадь', bucketId: 'f' }).correct).toBe(true)
  })
  it('wrong gives expected', () => {
    const r = check('classify', key, { itemId: 'тетрадь', bucketId: 'm' })
    expect(r.correct).toBe(false)
    expect(r.expected).toBe('f')
  })
  it('unknown item is wrong', () => {
    expect(check('classify', key, { itemId: 'x', bucketId: 'f' }).correct).toBe(false)
  })
})

describe('fill_blank', () => {
  it('normalizes answer', () => {
    expect(check('fill_blank', { a: ['гуляет'] }, { itemId: 'a', value: ' Гуляет. ' }).correct).toBe(true)
  })
  it('wrong', () => {
    expect(check('fill_blank', { a: ['гуляет'] }, { itemId: 'a', value: 'гуляют' }).correct).toBe(false)
  })
  it('accepts any variant, ё/е', () => {
    expect(check('fill_blank', { a: ['её', 'ее'] }, { itemId: 'a', value: 'ее' }).correct).toBe(true)
  })
})

describe('conjugate', () => {
  const forms = ['работаю', 'работаешь', 'работает', 'работаем', 'работаете', 'работают']
  it('all correct', () => {
    const r = check('conjugate', { forms }, { forms: [...forms] })
    expect(r.correct).toBe(true)
    expect(r.perItem).toHaveLength(6)
  })
  it('stress mark accepted', () => {
    const a = [...forms]
    a[2] = 'работает́'
    expect(check('conjugate', { forms }, { forms: a }).correct).toBe(true)
  })
  it('wrong 6th form', () => {
    const a = [...forms]
    a[5] = 'работаут'
    const r = check('conjugate', { forms }, { forms: a })
    expect(r.correct).toBe(false)
    expect(r.perItem![5]).toBe(false)
    expect(r.perItem!.slice(0, 5).every(Boolean)).toBe(true)
  })
  it('short answer is wrong', () => {
    const r = check('conjugate', { forms }, { forms: ['работаю'] })
    expect(r.correct).toBe(false)
    expect(r.perItem).toHaveLength(6)
  })
})

describe('choose', () => {
  it('matches index', () => {
    expect(check('choose', { q: 1 }, { itemId: 'q', index: 1 }).correct).toBe(true)
    const r = check('choose', { q: 1 }, { itemId: 'q', index: 0 })
    expect(r.correct).toBe(false)
    expect(r.expected).toBe(1)
  })
  it('index 0 key works', () => {
    expect(check('choose', { q: 0 }, { itemId: 'q', index: 0 }).correct).toBe(true)
  })
})

describe('match', () => {
  const key = { a: '1', b: '2', c: '3' }
  it('all pairs correct, order-independent', () => {
    expect(check('match', key, { pairs: [['b', '2'], ['a', '1'], ['c', '3']] }).correct).toBe(true)
  })
  it('swapped pair is wrong', () => {
    expect(check('match', key, { pairs: [['a', '2'], ['b', '1'], ['c', '3']] }).correct).toBe(false)
  })
  it('missing or duplicate pairs are wrong', () => {
    expect(check('match', key, { pairs: [['a', '1']] }).correct).toBe(false)
    expect(check('match', key, { pairs: [['a', '1'], ['a', '1'], ['b', '2']] }).correct).toBe(false)
  })
})

describe('unknown type', () => {
  it('throws', () => {
    expect(() => check('nope' as unknown as ExerciseType, {} as never, {} as never)).toThrow()
  })
})
