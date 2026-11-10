import { normalize } from './normalize'
import type { AnswerMap, CheckResult, ExerciseType, KeyMap } from './types'

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

export function check<T extends ExerciseType>(
  type: T,
  key: KeyMap[T],
  answer: AnswerMap[T],
): CheckResult {
  switch (type as ExerciseType) {
    case 'classify': {
      const k = key as KeyMap['classify']
      const a = answer as AnswerMap['classify']
      if (!has(k, a.itemId)) return { correct: false }
      const expected = k[a.itemId]
      return { correct: expected === a.bucketId, expected }
    }
    case 'fill_blank': {
      const k = key as KeyMap['fill_blank']
      const a = answer as AnswerMap['fill_blank']
      if (!has(k, a.itemId)) return { correct: false }
      const expected = k[a.itemId]
      const v = normalize(a.value)
      return { correct: expected.some((e) => normalize(e) === v), expected }
    }
    case 'conjugate': {
      const k = key as KeyMap['conjugate']
      const a = answer as AnswerMap['conjugate']
      const perItem = k.forms.map(
        (f, i) => typeof a.forms[i] === 'string' && normalize(a.forms[i]) === normalize(f),
      )
      return {
        correct: perItem.every(Boolean) && a.forms.length === k.forms.length,
        expected: k.forms,
        perItem,
      }
    }
    case 'choose': {
      const k = key as KeyMap['choose']
      const a = answer as AnswerMap['choose']
      if (!has(k, a.itemId)) return { correct: false }
      const expected = k[a.itemId]
      return { correct: expected === a.index, expected }
    }
    case 'match': {
      const k = key as KeyMap['match']
      const a = answer as AnswerMap['match']
      const leftIds = Object.keys(k)
      const given = new Map<string, string>()
      for (const [l, r] of a.pairs) given.set(l, r)
      const ok =
        a.pairs.length === leftIds.length &&
        given.size === leftIds.length &&
        leftIds.every((l) => given.get(l) === k[l])
      return { correct: ok, expected: k }
    }
    default:
      throw new Error(`Unknown exercise type: ${String(type)}`)
  }
}
