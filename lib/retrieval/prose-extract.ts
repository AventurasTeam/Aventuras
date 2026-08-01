import { matchTerms, type NameKeywordIndex } from './name-index'

const WEIGHT = { entity: 3, keyword: 3, verb: 2, dialogue: 2, brevity: 1 } as const

const ACTION_VERBS = new Set([
  'drew',
  'struck',
  'said',
  'killed',
  'swore',
  'revealed',
  'named',
  'refused',
  'agreed',
  'ran',
  'fled',
  'found',
  'lost',
])

const BREVITY_CHARS = 90

// A bare straight quote/apostrophe (as in "didn't") is not a quoted span;
// require an actual open+close pair so contractions don't score as dialogue.
const DIALOGUE_SPAN = /"[^"]*"|“[^”]*”|‘[^’]*’/u

export function splitSentences(prose: string): string[] {
  // Includes the Unicode ellipsis character alongside "...": without it, "…"
  // doesn't end a sentence and the next clause silently merges into this one.
  return prose
    .split(/(?<=[.!?…])\s+/u)
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

export type ProseExtract = {
  /** The selected sentences, joined, in source order. */
  text: string
  /** One score per sentence, in source order — probe.md's per-sentence selection scores. */
  scores: number[]
}

function scoreSentence(sentence: string, index: NameKeywordIndex): number {
  let score = 0
  if (matchTerms(sentence, index.entityNames).length > 0) score += WEIGHT.entity
  if (matchTerms(sentence, index.loreKeywords).length > 0) score += WEIGHT.keyword
  const words = sentence.toLowerCase().match(/[a-z']+/gu) ?? []
  if (words.some((w) => ACTION_VERBS.has(w))) score += WEIGHT.verb
  if (DIALOGUE_SPAN.test(sentence)) score += WEIGHT.dialogue
  if (sentence.length <= BREVITY_CHARS) score += WEIGHT.brevity
  return score
}

export function extractProse(prose: string, index: NameKeywordIndex, topK: number): ProseExtract {
  const sentences = splitSentences(prose)
  if (sentences.length === 0) return { text: '', scores: [] }

  const scores = sentences.map((s) => scoreSentence(s, index))
  const chosen = scores
    .map((score, i) => ({ score, i }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, Math.max(1, topK))
    .map((x) => x.i)
    .sort((a, b) => a - b)

  return { text: chosen.map((i) => sentences[i]).join(' '), scores }
}
