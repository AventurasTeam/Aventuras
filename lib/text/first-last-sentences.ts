import { oneLine } from './one-line'

/** The most code points each `firstLastSentences` sentence may hold, before its ellipsis. */
export const SENTENCE_EXCERPT_MAX = 240

// A Latin mark ends a sentence only before a space or the end, so "3.5" holds; a CJK mark needs
// none. Closing quotes, brackets and markdown emphasis after the mark stay with the sentence it
// ends. The lookbehind starts a match only at a run's first mark; else a long run of marks
// backtracks quadratically.
const SENTENCE_END = /(?<![.!?])[.!?]+["'”’»“«)\]*_]*(?=\s|$)|[。！？｡]+["'”’」』)）｣]*/gu

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u

// A period after a title or an initial abbreviates; "I." still ends a sentence. Read over the five
// code units before the period: the longest title and the boundary before it.
const ABBREVIATION = /(?:^|[^\p{L}])(?:Mr|Mrs|Ms|Dr|St|Mt|Capt|Col|Lt|Sgt|Prof|Rev|(?!I)\p{Lu})$/u
const ABBREVIATION_WINDOW = 5

// A Latin mark before a lowercase word ends no sentence: a dialogue tag (`!” said Jim`), "e.g."
const LOWERCASE_NEXT = /\s+\p{Ll}/uy

// A French closer spaced off its mark belongs to the sentence it closes.
const LEADING_CLOSERS = /^([»”’)\]]+)\s*/u

function endsSentence(flat: string, sentenceStart: number, match: RegExpExecArray): boolean {
  if (/^[。！？｡]/u.test(match[0])) return true
  LOWERCASE_NEXT.lastIndex = match.index + match[0].length
  if (LOWERCASE_NEXT.test(flat)) return false
  if (match[0] !== '.') return true
  const before = flat.slice(Math.max(sentenceStart, match.index - ABBREVIATION_WINDOW), match.index)
  return !ABBREVIATION.test(before)
}

type Pieces = { sentences: string[]; opening: string }

// A piece with no letter or digit (a French closer, an ellipsis, a scene break) joins the sentence
// before it, or the first sentence when it opens the text.
function addPiece(pieces: Pieces, piece: string): void {
  const { sentences } = pieces
  const closers = sentences.length > 0 ? LEADING_CLOSERS.exec(piece) : null
  if (closers != null) {
    sentences[sentences.length - 1] += ` ${closers[1]}`
    piece = piece.slice(closers[0].length)
    if (piece === '') return
  }
  if (!LETTER_OR_DIGIT.test(piece)) {
    if (sentences.length > 0) sentences[sentences.length - 1] += ` ${piece}`
    else pieces.opening = pieces.opening === '' ? piece : `${pieces.opening} ${piece}`
    return
  }
  sentences.push(pieces.opening === '' ? piece : `${pieces.opening} ${piece}`)
  pieces.opening = ''
}

// Array.from splits code points, so the cut never severs a surrogate pair. `first` keeps its head
// and `last` its tail, where the turn stops; each cuts at a space when one falls near the cap.
function capped(sentence: string, maxChars: number, keep: 'head' | 'tail'): string {
  const chars = Array.from(sentence)
  if (chars.length <= maxChars) return sentence
  const slack = Math.floor(maxChars / 2)
  if (keep === 'head') {
    let cut = maxChars
    for (let i = maxChars; i >= maxChars - slack; i--) {
      if (chars[i] === ' ') {
        cut = i
        break
      }
    }
    return `${chars.slice(0, cut).join('')}…`
  }
  const start = chars.length - maxChars
  let cut = start
  for (let i = start - 1; i <= start - 1 + slack; i++) {
    if (chars[i] === ' ') {
      cut = i + 1
      break
    }
  }
  return `…${chars.slice(cut).join('')}`
}

/**
 * A text's first and last sentences, each on one line; one over `maxChars` code points is cut to
 * at most that many, `first` keeping its start and `last` its end, with '…' at the cut. `last` is
 * null for a text of one sentence, or of none; a blank text gives an empty `first`. Prompt prose
 * takes `promptProse` first, which this module can't import.
 */
export function firstLastSentences(
  text: string,
  maxChars: number = SENTENCE_EXCERPT_MAX,
): { first: string; last: string | null } {
  const flat = oneLine(text)
  if (flat === '') return { first: '', last: null }
  const pieces: Pieces = { sentences: [], opening: '' }
  let start = 0
  for (const match of flat.matchAll(SENTENCE_END)) {
    if (!endsSentence(flat, start, match)) continue
    const end = match.index + match[0].length
    addPiece(pieces, flat.slice(start, end).trim())
    start = end
  }
  const rest = flat.slice(start).trim()
  if (rest !== '') addPiece(pieces, rest)
  const { sentences } = pieces
  if (sentences.length === 0) sentences.push(pieces.opening)
  const last = sentences.length > 1 ? sentences[sentences.length - 1] : null
  return {
    first: capped(sentences[0], maxChars, 'head'),
    last: last === null ? null : capped(last, maxChars, 'tail'),
  }
}
