import { VISUAL_TEXT_MAX } from './types'

const CJK_CLAUSE_MARKS = '。、，；！？'
const SENTENCE_ENDS = '.。！？'

/**
 * piggyback.md → Trailing block format. An over-long value fails every later updateEntity's
 * whole-state re-validation, so cut it at a clause or word boundary in the bound's second half,
 * else mid-word; by UTF-16 unit (Zod's `.length`), never mid-surrogate.
 */
export function boundStateText(text: string): { text: string; cut: boolean } {
  if (text.length <= VISUAL_TEXT_MAX) return { text, cut: false }
  return { text: cutAtBoundary(text), cut: true }
}

function cutAtBoundary(text: string): string {
  const head = text.slice(0, VISUAL_TEXT_MAX)
  // Below the midpoint a cut drops half the bound or more, too much to pay for a cleaner one.
  const floor = VISUAL_TEXT_MAX / 2
  // ASCII marks end a clause only before whitespace ("1.8 m" has none); CJK marks need none.
  let clause = -1
  for (let i = head.length - 1; i >= floor && clause < 0; i--) {
    const mark = head[i]!
    if (CJK_CLAUSE_MARKS.includes(mark) || ('.;,'.includes(mark) && /\s/.test(text[i + 1]!)))
      clause = i
  }
  const atClause =
    clause < 0 ? '' : head.slice(0, SENTENCE_ENDS.includes(head[clause]!) ? clause + 1 : clause)
  if (atClause.trim() !== '') return atClause.trimEnd()
  // Whitespace just past the bound still ends the head's last word.
  const space = text.slice(0, VISUAL_TEXT_MAX + 1).search(/\s\S*$/)
  const atSpace = space < floor ? '' : head.slice(0, space).trimEnd()
  if (atSpace !== '') return atSpace
  const lastUnit = head.charCodeAt(head.length - 1)
  return lastUnit >= 0xd800 && lastUnit <= 0xdbff ? head.slice(0, -1) : head
}
