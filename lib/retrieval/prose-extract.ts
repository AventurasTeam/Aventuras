import { matchTerms, type NameKeywordIndex } from './name-index'

// Numeric encoding of retrieval.md's Q3 High/Medium/Low ordinal weights; only
// the relative ordering (entity, keyword > verb, dialogue > brevity) is canon.
const WEIGHT = { entity: 3, keyword: 3, verb: 2, dialogue: 2, brevity: 1 } as const

// Verbatim from retrieval.md's Q3 signal table, which introduces the list with
// "…" — i.e. illustrative examples, not a claim of exhaustive verb coverage.
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

const BREVITY_MAX_CHARS = 90
// Below this, a "sentence" is more likely an abbreviation fragment left over
// from over-splitting (Mr., Capt., Prof. top out at 5 chars) than a genuine
// short clause; 6 is the first length none of those abbreviations reach,
// while still admitting ordinary short subject+verb sentences ("I ran.").
const BREVITY_MIN_CHARS = 6

// A bare straight quote/apostrophe (as in "didn't") is not a quoted span;
// require an actual open+close pair so contractions don't score as dialogue.
const DIALOGUE_SPAN = /"[^"]*"|“[^”]*”|‘[^’]*’/gu

export function splitSentences(prose: string): string[] {
  // Includes the Unicode ellipsis character alongside "...": without it, "…"
  // doesn't end a sentence and the next clause silently merges into this one.
  return prose
    .split(/(?<=[.!?…])\s+/u)
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

type Span = { start: number; end: number }

function dialogueSpans(prose: string): Span[] {
  const spans: Span[] = []
  for (const match of prose.matchAll(DIALOGUE_SPAN)) {
    spans.push({ start: match.index, end: match.index + match[0].length })
  }
  return spans
}

// Sentences are re-derived strings, not slices, so their position in `prose`
// has to be recovered to test against dialogue spans found over the whole
// text — a quoted span can open in one sentence and close in the next.
function sentenceSpans(prose: string, sentences: string[]): Span[] {
  const spans: Span[] = []
  let cursor = 0
  for (const sentence of sentences) {
    const start = prose.indexOf(sentence, cursor)
    const safeStart = start === -1 ? cursor : start
    const end = safeStart + sentence.length
    spans.push({ start: safeStart, end })
    cursor = end
  }
  return spans
}

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end
}

export type ProseExtract = {
  /** The sentences `scores` was computed over, in source order. */
  sentences: string[]
  /** The selected sentences, joined, in source order. */
  text: string
  /** One score per sentence, in source order — probe.md's per-sentence selection scores. */
  scores: number[]
}

function scoreSentence(sentence: string, index: NameKeywordIndex, hasDialogue: boolean): number {
  let score = 0
  if (matchTerms(sentence, index.entityNames).length > 0) score += WEIGHT.entity
  if (matchTerms(sentence, index.loreKeywords).length > 0) score += WEIGHT.keyword
  const words = sentence.toLowerCase().match(/[\p{L}\p{M}']+/gu) ?? []
  if (words.some((w) => ACTION_VERBS.has(w))) score += WEIGHT.verb
  if (hasDialogue) score += WEIGHT.dialogue
  if (sentence.length >= BREVITY_MIN_CHARS && sentence.length <= BREVITY_MAX_CHARS) {
    score += WEIGHT.brevity
  }
  return score
}

export function extractProse(prose: string, index: NameKeywordIndex, topK: number): ProseExtract {
  const sentences = splitSentences(prose)
  if (sentences.length === 0) return { sentences, text: '', scores: [] }

  const quoteSpans = dialogueSpans(prose)
  const spans = sentenceSpans(prose, sentences)
  const scores = sentences.map((s, i) =>
    scoreSentence(
      s,
      index,
      quoteSpans.some((q) => overlaps(q, spans[i])),
    ),
  )

  // Selection is by score, but the chosen indices are re-sorted back to source
  // order before joining: the join is embedded as a single vector, and
  // reordered prose embeds differently than the original narrative sequence.
  const chosen = scores
    .map((score, i) => ({ score, i }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, Math.max(1, topK))
    .map((x) => x.i)
    .sort((a, b) => a - b)

  return { sentences, text: chosen.map((i) => sentences[i]).join(' '), scores }
}
