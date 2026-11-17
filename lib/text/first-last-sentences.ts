import { oneLine } from './one-line'

/** The most code points each sentence `firstLastSentences` returns may hold, before its ellipsis. */
export const SENTENCE_EXCERPT_MAX = 240

// A Latin mark ends a sentence only before a space or the end, so "3.5" holds; a CJK mark needs
// none. Closing quotes and brackets after the mark stay with the sentence it ends. The lookbehind
// starts a match only at a run's first mark; without it a long run of marks backtracks quadratically.
const SENTENCE_END = /(?<![.!?])[.!?]+["'”’»“«)\]]*(?=\s|$)|[。！？]+["'”’」』)）]*/gu

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u

// French spacing puts a space before », so the closer can land alone in a piece; it joins the
// sentence before it.
function addPiece(sentences: string[], piece: string): void {
  if (sentences.length > 0 && !LETTER_OR_DIGIT.test(piece)) {
    sentences[sentences.length - 1] += ` ${piece}`
  } else {
    sentences.push(piece)
  }
}

// Array.from splits code points, so the cut never severs a surrogate pair.
function capped(sentence: string, maxChars: number): string {
  const chars = Array.from(sentence)
  if (chars.length <= maxChars) return sentence
  let cut = maxChars
  for (let i = maxChars; i >= Math.ceil(maxChars / 2); i--) {
    if (chars[i] === ' ') {
      cut = i
      break
    }
  }
  return `${chars.slice(0, cut).join('')}…`
}

/**
 * A text's first and last sentences, each on one line and capped at `maxChars` code points. `last`
 * is null for a text of one sentence, or of none; a blank text gives an empty `first`. Prompt prose
 * takes `promptProse` first, which this module can't import.
 */
export function firstLastSentences(
  text: string,
  maxChars: number = SENTENCE_EXCERPT_MAX,
): { first: string; last: string | null } {
  const flat = oneLine(text)
  if (flat === '') return { first: '', last: null }
  const sentences: string[] = []
  let start = 0
  for (const match of flat.matchAll(SENTENCE_END)) {
    const end = match.index + match[0].length
    addPiece(sentences, flat.slice(start, end).trim())
    start = end
  }
  const rest = flat.slice(start).trim()
  if (rest !== '') addPiece(sentences, rest)
  const last = sentences.length > 1 ? sentences[sentences.length - 1] : null
  return {
    first: capped(sentences[0], maxChars),
    last: last === null ? null : capped(last, maxChars),
  }
}
