export type ExerciseType = 'classify' | 'fill_blank' | 'conjugate' | 'choose' | 'match'

export const PRONOUNS = ['я', 'ты', 'он/она', 'мы', 'вы', 'они'] as const

// Payload: sent to the client
export type ClassifyPayload = {
  items: { id: string; text: string }[]
  buckets: { id: string; label: string; hint?: string }[]
}
export type FillBlankPayload = {
  items: { id: string; before: string; after: string; hint?: string }[]
}
export type ConjugatePayload = { verb: string; pronouns: string[] }
export type ChoosePayload = {
  items: { id: string; text: string; options: string[] }[]
}
export type MatchPayload = {
  left: { id: string; text: string }[]
  right: { id: string; text: string }[]
}

// Key: server only
export type ClassifyKey = Record<string, string>
export type FillBlankKey = Record<string, string[]>
export type ConjugateKey = { forms: string[] }
export type ChooseKey = Record<string, number>
export type MatchKey = Record<string, string>

// Answer: from the client
export type ClassifyAnswer = { itemId: string; bucketId: string }
export type FillBlankAnswer = { itemId: string; value: string }
export type ConjugateAnswer = { forms: string[] }
export type ChooseAnswer = { itemId: string; index: number }
export type MatchAnswer = { pairs: [string, string][] }

export interface PayloadMap {
  classify: ClassifyPayload
  fill_blank: FillBlankPayload
  conjugate: ConjugatePayload
  choose: ChoosePayload
  match: MatchPayload
}
export interface KeyMap {
  classify: ClassifyKey
  fill_blank: FillBlankKey
  conjugate: ConjugateKey
  choose: ChooseKey
  match: MatchKey
}
export interface AnswerMap {
  classify: ClassifyAnswer
  fill_blank: FillBlankAnswer
  conjugate: ConjugateAnswer
  choose: ChooseAnswer
  match: MatchAnswer
}

export type CheckResult = {
  correct: boolean
  expected?: unknown
  perItem?: boolean[]
}
