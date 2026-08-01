/**
 * Text utility functions for cleaning and normalizing text content.
 */

const uncommonCharacters: Record<string, string> = {
  // Quotes
  '’': "'",
  '‘': "'",
  '“': '"',
  '”': '"',
  '‟': '"',
  '„': '"',
  '‚': "'",
  // Dashes
  '–': '-',
  '—': '-',
  '−': '-',
  // Others
  '…': '...',
  '\u00A0': ' ', // Non-breaking space
}

/**
 * Normalizes common "uncommon" characters (smart quotes, dashes, etc.) to their standard ASCII equivalents.
 */
function replaceUncommonCharacters(content: string): string {
  if (!content) return ''
  let result = content
  for (const [uncommon, common] of Object.entries(uncommonCharacters)) {
    result = result.replaceAll(uncommon, common)
  }
  return result
}

/**
 * Escapes special regex characters.
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface EntityNameMatchOptions {
  /**
   * Also match when a word in `searchText` merely *starts with* the name ("ren" ->
   * "renaissance"). Trades precision for recall, so it is opt-in per caller:
   *
   * - `WorldStateInjector` sets it. Its names are live entity names, and missing a
   *   mention costs the narrator a character/location it should have known about.
   * - `EntryRetrievalService` does NOT. Its names are user-authored lorebook keywords,
   *   where a false positive silently injects an unrelated entry into every prompt --
   *   the exact complaint fixed in 4c2a7481 ("prevent substring matching for
   *   keywords", 'hulk' triggering on 'madhulkman'). Prefix matching is a weaker form
   *   of the same bug ('hulk' -> 'hulking', 'cat' -> 'catastrophe'), so it stays off.
   * - `inspect_world_state` sets it, and note that it uses this function with the
   *   arguments the other way round: the *query* is `name` and the *entity* is
   *   `searchText`, so here the flag means "an entity whose name starts with what the
   *   agent typed". A false positive costs an agent one line of a tool result it can
   *   read and dismiss, rather than a wrong entry in the narrator's prompt -- so the
   *   trade that makes it wrong for lorebook keywords is what makes it right for a
   *   search tool.
   *
   * Defaults to false: the safe behaviour is the strict one.
   */
  allowPrefix?: boolean
}

/**
 * Checks whether `name` (a character/location/item/entry name, alias, or keyword)
 * appears in `searchText`. Matching is case-insensitive; the caller does not have to
 * lowercase anything first. Strategies, in order:
 * 1. Non-space-separated scripts (CJK, Thai, Lao, Khmer, Burmese) have no word
 *    boundaries to anchor a regex on, so these fall back to plain substring matching.
 * 2. Unicode-aware word-boundary match for space-separated languages (avoids
 *    matching "Ren" inside "Warren").
 * 3. Only when `allowPrefix` is set: a prefix-match fallback for names of 3+
 *    characters. See `EntityNameMatchOptions.allowPrefix` for why this is per-caller.
 *
 * Shared by `EntryRetrievalService` (lorebook entries) and `WorldStateInjector`
 * (live world-state entities) -- both need the same "does this name show up in the
 * recent narrative" check, at different strictness.
 */
export function entityNameMatches(
  name: string,
  searchText: string,
  options: EntityNameMatchOptions = {},
): boolean {
  const { allowPrefix = false } = options
  const normalizedName = name.toLowerCase().trim()
  if (normalizedName.length < 2) return false

  // Lowercased here rather than trusted from the caller. The word-boundary regex below
  // carries the `i` flag and so never cared, but the prefix branch compares raw strings --
  // so a caller passing text as written silently lost every prefix match ("ari" did not
  // match "Aria", only "aria"). `inspect_world_state` passes entity names and descriptions
  // straight through, which is exactly that case, and it is the one tool whose whole job
  // is finding an entity by a partial name.
  const haystack = searchText.toLowerCase()

  // CJK, Hangul, Thai, Lao, Khmer, Burmese ranges (no spaces between words in these scripts)
  const isNonSpaceSeparated =
    /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\u0e00-\u0e7f\u0e80-\u0eff\u1780-\u17ff\u1000-\u109f]/.test(
      normalizedName,
    )
  if (isNonSpaceSeparated) {
    return haystack.includes(normalizedName)
  }

  let patternStr = escapeRegex(normalizedName)
  if (/^[\p{L}\p{N}]/u.test(normalizedName)) {
    patternStr = '(?<![\\p{L}\\p{N}])' + patternStr
  }
  if (/[\p{L}\p{N}]$/u.test(normalizedName)) {
    patternStr = patternStr + '(?![\\p{L}\\p{N}])'
  }
  if (new RegExp(patternStr, 'iu').test(haystack)) {
    return true
  }

  if (allowPrefix && normalizedName.length >= 3) {
    const words = haystack.split(/\s+/)
    if (words.some((word) => word.startsWith(normalizedName))) {
      return true
    }
  }

  return false
}

export interface TextMatch {
  /** Indexes of every matched paragraph inside this excerpt's window (0-based, ascending) */
  paragraphIndexes: number[]
  /** First paragraph included in the excerpt (a matched paragraph, or context before one) */
  startParagraph: number
  /** Last paragraph included in the excerpt */
  endParagraph: number
  /** The matched paragraph(s) plus surrounding context, joined back with blank lines */
  excerpt: string
}

export interface FindTextMatchesOptions {
  /**
   * Grow the window by whole paragraphs until it holds at least this many words.
   *
   * A paragraph count is the wrong control here, and measurement says so: on real story
   * text a fixed window of three paragraphs overshot the output budget 75% of the time --
   * so the budget decided the size and the paragraph count did nothing -- while the
   * remaining cases came back as thin as 17 words, too little to judge a hit by.
   *
   * Words are the budget, paragraphs are the unit it grows in: predictable cost, and the
   * excerpt still starts and ends where the prose does.
   */
  minWords?: number
  /**
   * Require the query to sit on word boundaries rather than matching inside a word.
   * Off by default -- prose search wants "sword" to find "swords".
   */
  wholeWord?: boolean
  /**
   * Match case exactly. Off by default; on, it is what separates a shouted or written
   * token like "HOPE" from the ordinary word "hope" scattered through the prose.
   */
  caseSensitive?: boolean
}

/**
 * Fold away the differences that make a literal search fail on prose it should have
 * matched: typographic quotes/dashes that the model types as ASCII (or vice versa), and
 * line breaks inside a paragraph, which otherwise break any query spanning one.
 *
 * Applied to the query and to a *copy* of the text; excerpts are always returned from
 * the original so the agent reads the story as written.
 */
function normalizeForSearch(text: string, caseSensitive = false): string {
  return (caseSensitive ? text : text.toLowerCase())
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim()
}

function paragraphContains(
  paragraph: string,
  query: string,
  wholeWord: boolean,
  caseSensitive: boolean,
): boolean {
  const haystack = normalizeForSearch(paragraph, caseSensitive)
  if (!wholeWord) return haystack.includes(query)

  let pattern = escapeRegex(query)
  if (/^[\p{L}\p{N}]/u.test(query)) pattern = '(?<![\\p{L}\\p{N}])' + pattern
  if (/[\p{L}\p{N}]$/u.test(query)) pattern = pattern + '(?![\\p{L}\\p{N}])'
  return new RegExp(pattern, 'u').test(haystack)
}

/**
 * Whether a paragraph matches `query`, under the same rules `findTextMatches` applies.
 *
 * Exported so a caller can count matches in a *returned excerpt* in the same unit the excerpt
 * was counted in. Doing it with a hand-rolled regex would drift from the folding above.
 */
export function paragraphMatches(
  paragraph: string,
  query: string,
  options: { wholeWord?: boolean; caseSensitive?: boolean } = {},
): boolean {
  const { wholeWord = false, caseSensitive = false } = options
  const normalizedQuery = normalizeForSearch(query, caseSensitive)
  if (!normalizedQuery) return false
  return paragraphContains(paragraph, normalizedQuery, wholeWord, caseSensitive)
}

/** Words in a string, for the excerpt budget. Cheap and good enough to size prose by. */
function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

/**
 * Case-insensitive search across the paragraphs of `content` (split on blank lines, the same
 * convention used elsewhere in this codebase -- see `createFuzzyTextRegex` below).
 *
 * Each returned match is a *window*: the matched paragraph plus one either side, grown by
 * whole paragraphs until it holds `minWords`, and clamped to `content`'s own boundaries (it
 * never reaches into another entry). Windows that would overlap are merged into one, so two
 * nearby matches come back as a single excerpt listing both paragraph indexes rather than as
 * two excerpts repeating most of the same prose.
 *
 * There is no maximum here: trimming an over-long window has to stay centred on the match,
 * which is `truncateAroundMatch`'s job and needs the query rather than the paragraphs.
 */
export function findTextMatches(
  content: string,
  query: string,
  options: FindTextMatchesOptions = {},
): TextMatch[] {
  const { minWords = 0, wholeWord = false, caseSensitive = false } = options

  const normalizedQuery = normalizeForSearch(query, caseSensitive)
  if (!normalizedQuery || !content) return []

  const paragraphs = content.split(/\n\s*\n/)

  const hitIndexes: number[] = []
  for (let i = 0; i < paragraphs.length; i++) {
    if (paragraphContains(paragraphs[i], normalizedQuery, wholeWord, caseSensitive))
      hitIndexes.push(i)
  }
  if (hitIndexes.length === 0) return []

  /**
   * One paragraph either side, then alternately reach further out until the window holds
   * `minWords` or runs out of entry. Alternating keeps the match roughly centred; taking
   * only from one side would push it to an edge and lose the run-up to it.
   */
  const grow = (index: number): [number, number] => {
    let start = Math.max(0, index - 1)
    let end = Math.min(paragraphs.length - 1, index + 1)
    let words = countWords(paragraphs.slice(start, end + 1).join(' '))

    while (words < minWords && (start > 0 || end < paragraphs.length - 1)) {
      if (start > 0) {
        start--
        words += countWords(paragraphs[start])
      }
      if (words < minWords && end < paragraphs.length - 1) {
        end++
        words += countWords(paragraphs[end])
      }
    }
    return [start, end]
  }

  const matches: TextMatch[] = []
  for (const index of hitIndexes) {
    const [start, end] = grow(index)

    const previous = matches[matches.length - 1]
    // `<=` and not `<`: windows that merely touch are merged too, since emitting them
    // separately would repeat the boundary paragraph in both excerpts.
    if (previous && start <= previous.endParagraph + 1) {
      previous.endParagraph = Math.max(previous.endParagraph, end)
      previous.paragraphIndexes.push(index)
      previous.excerpt = paragraphs
        .slice(previous.startParagraph, previous.endParagraph + 1)
        .join('\n\n')
      continue
    }

    matches.push({
      paragraphIndexes: [index],
      startParagraph: start,
      endParagraph: end,
      excerpt: paragraphs.slice(start, end + 1).join('\n\n'),
    })
  }

  return matches
}

/**
 * A regex source matching `query` in text that has *not* been through
 * `normalizeForSearch` -- the exact inverse of the folding that function does.
 *
 * `findTextMatches` matches on a normalized copy but returns excerpts cut from the
 * original, so anything that then wants to locate the match inside one of those excerpts
 * cannot search for the raw query: an apostrophe typed as `'` will not be found in prose
 * written with `’`, and a query spanning a line break will not be found at all. Folding
 * the excerpt instead is not an option -- it is the text the caller displays.
 */
function searchPattern(query: string): string {
  const groups = ["'‘’ʼ′", '"“”″', '-–—−']
  let pattern = ''
  let i = 0

  while (i < query.length) {
    const char = query[i]

    if (/\s/.test(char)) {
      while (i < query.length && /\s/.test(query[i])) i++
      pattern += '\\s+'
      continue
    }

    // Both spellings of an ellipsis, whichever one the query used.
    if (char === '…' || query.startsWith('...', i)) {
      pattern += '(?:\\.\\.\\.|…)'
      i += char === '…' ? 1 : 3
      continue
    }

    const group = groups.find((g) => g.includes(char))
    pattern += group ? `[${group}]` : escapeRegex(char)
    i++
  }

  return pattern
}

/**
 * End of a sentence: terminator plus any closing quote or bracket, then whitespace.
 *
 * Built per call rather than shared at module scope. A single `/g` regex reused by two
 * functions carries `lastIndex` between them, so correctness rests on every caller
 * remembering to reset it first -- a property nothing enforces and a future third caller
 * would have no reason to suspect.
 */
const sentenceEndPattern = () => /[.!?][")'\]]*\s/g

/**
 * Where the sentence containing `index` begins.
 *
 * Excerpts used to start wherever the word budget happened to land, which on real prose
 * meant almost all of them opened mid-clause -- "corridor is not just a simple tunnel",
 * "Malakor is with the healers," Vorlag rumbles". Readable is not a luxury here: the agent
 * has to judge from these whether a passage is the one it wants.
 */
function sentenceStart(text: string, index: number): number {
  let best = 0
  const paragraph = text.lastIndexOf('\n', index)
  if (paragraph !== -1) best = paragraph + 1

  const pattern = sentenceEndPattern()
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    if (m.index >= index) break
    best = Math.max(best, m.index + m[0].length)
  }
  return best
}

/** The end of the sentence at or after `index`, or -1 if the text just runs out. */
function sentenceEnd(text: string, index: number): number {
  const pattern = sentenceEndPattern()
  pattern.lastIndex = index
  const m = pattern.exec(text)
  return m ? m.index + m[0].length : -1
}

/**
 * Every occurrence of `pattern` in `text`, as [start, end) offsets.
 *
 * `findTextMatches` merges paragraphs that match into one passage precisely so adjacent
 * mentions arrive together; this is what lets the truncation below avoid cutting between
 * them again.
 */
function matchSpans(text: string, pattern: string, caseSensitive: boolean): [number, number][] {
  const regex = new RegExp(pattern, caseSensitive ? 'gu' : 'giu')
  const spans: [number, number][] = []
  for (let m = regex.exec(text); m; m = regex.exec(text)) {
    spans.push([m.index, m.index + m[0].length])
    // Zero-width patterns cannot happen here (the query is non-empty), but a stuck lastIndex
    // would hang the loop, so step it explicitly.
    if (m[0].length === 0) regex.lastIndex++
  }
  return spans
}

/**
 * Cut `text` down to roughly `maxWords`, opening at a sentence boundary.
 *
 * When every occurrence of `query` fits inside the budget, the window covers **all of them**
 * rather than the first: the passage exists because `findTextMatches` merged neighbouring
 * matching paragraphs, and re-cutting it around the first mention throws that away and hands
 * the agent a fragment where it had a scene. Only when the span genuinely does not fit does
 * the window fall back to the first occurrence.
 *
 * Words rather than characters, so the cost of an excerpt is predictable in the only unit
 * that matters downstream -- tokens -- instead of varying with how long the prose's words
 * happen to be. But the cut is snapped to sentences, because a budget that lands mid-clause
 * produces text nobody can judge.
 *
 * The match is deliberately near the *start*: the passage was returned because of it, and
 * burying it in the middle made the agent read half an excerpt to find out why it was
 * given one.
 *
 * Falls back to the head only when the query genuinely is not present, which, thanks to
 * `searchPattern`, now means what it says.
 */
export function truncateAroundMatch(
  text: string,
  query: string,
  maxWords: number,
  caseSensitive = false,
): string {
  if (countWords(text) <= maxWords) return text

  const pattern = searchPattern(query.trim())
  const spans = pattern ? matchSpans(text, pattern, caseSensitive) : []
  const matchIndex = spans.length > 0 ? spans[0][0] : -1

  const takeWords = (from: number, count: number): [string, boolean] => {
    const rest = text.slice(from)
    const tokens = rest.split(/(\s+)/)
    const kept: string[] = []
    let words = 0
    for (const token of tokens) {
      if (token.trim()) {
        if (words === count) break
        words++
      }
      kept.push(token)
    }
    const body = kept.join('').trimEnd()
    return [body, from + body.length < text.trimEnd().length]
  }

  if (matchIndex === -1) {
    const [body, truncated] = takeWords(0, maxWords)
    return truncated ? `${body}…` : body
  }

  // Whole span first: if all the occurrences fit, keep them together.
  if (spans.length > 1) {
    const spanStart = sentenceStart(text, matchIndex)
    const lastEnd = spans[spans.length - 1][1]
    const closing = sentenceEnd(text, lastEnd)
    const spanEnd = closing === -1 ? text.trimEnd().length : closing
    if (spanEnd > spanStart && countWords(text.slice(spanStart, spanEnd)) <= maxWords) {
      const body = text.slice(spanStart, spanEnd).trimEnd()
      const more = spanStart + body.length < text.trimEnd().length
      return `${spanStart > 0 ? '…' : ''}${body}${more ? '…' : ''}`
    }
  }

  // Open at a sentence boundary, but never at the cost of the match itself: the passage was
  // returned because of it, and an excerpt that cuts off before it is worse than an ugly
  // one. Prose that offers no boundary near enough -- a very long sentence, a wall of text
  // -- falls back to placing the match a quarter of the way in.
  const own = sentenceStart(text, matchIndex)
  const previous = own > 0 ? sentenceStart(text, own - 1) : 0
  const runUp = countWords(text.slice(previous, own))
  let start = runUp > 0 && runUp < maxWords / 3 ? previous : own

  if (countWords(text.slice(start, matchIndex)) > (maxWords * 3) / 4) {
    const before = text.slice(0, matchIndex).split(/(\s+)/)
    const keep = Math.floor(maxWords / 4) * 2
    start = matchIndex - before.slice(Math.max(0, before.length - keep)).join('').length
  }

  const [body, truncated] = takeWords(start, maxWords)

  // Close on a sentence if one ends just past the budget rather than stopping mid-clause.
  let tail = body
  if (truncated) {
    const close = sentenceEnd(text, start + body.length)
    const overrun = close === -1 ? Infinity : countWords(text.slice(start + body.length, close))
    if (overrun <= maxWords / 4) tail = text.slice(start, close).trimEnd()
  }

  const stillMore = start + tail.length < text.trimEnd().length
  return `${start > 0 ? '…' : ''}${tail}${stillMore ? '…' : ''}`
}

/**
 * Fuzzy text match that is more resilient to markdown and formatting.
 * Splits text into alphanumeric words and allows any non-alphanumeric characters
 * (markdown, punctuation, whitespace, single newlines) between them.
 */
export function createFuzzyTextRegex(text: string): RegExp {
  if (!text) return /$.^/ // Matches nothing

  // 1. Normalize
  const normalized = replaceUncommonCharacters(text)

  // 2. Extract alphanumeric "words"
  const words = normalized.split(/[^a-zA-Z0-9'’‘‚]+/).filter((word) => word.length > 0)

  if (words.length === 0) {
    return new RegExp(escapeRegex(text), 'gi')
  }

  // 3. Escape words and handle variants
  const patternParts = words.map((word) => {
    return escapeRegex(word).replace(/'/g, "[\\'’‘‚]").replace(/"/g, '[\\"“”„‟]')
  })

  // 4. Join with a "super-fuzzy" separator
  // We strictly forbid newlines that are part of a paragraph break (\\n\\n), on either side,
  // so the match can neither cross a paragraph boundary nor start/end by absorbing one of the
  // two newlines into the match itself (which would delete it once the match gets replaced by
  // a placeholder, collapsing "\n\n" into "\n" and merging the paragraph with the previous one).
  const fuzzySeparator = '(?:[^a-zA-Z0-9\\n]|(?<!\\n)\\n(?!\\n))*?'

  const pattern = fuzzySeparator + patternParts.join(fuzzySeparator) + fuzzySeparator

  return new RegExp(pattern, 'gi')
}

const SENTENCE_DELIMITERS = /[.!?\n]/

/** Scan backward from `from` to find the start of the sentence (stops at `limit`). */
function findSentenceStart(text: string, from: number, limit: number = 0): number {
  let pos = from
  while (pos > limit && !SENTENCE_DELIMITERS.test(text[pos - 1])) pos--
  return pos
}

/** Scan forward from `from` to find the end of the sentence, including the delimiter (stops at `limit`). */
function findSentenceEnd(text: string, from: number, limit: number = text.length): number {
  let pos = from
  while (pos < limit && !SENTENCE_DELIMITERS.test(text[pos])) pos++
  if (pos < limit && SENTENCE_DELIMITERS.test(text[pos])) pos++
  return pos
}

/**
 * Extracts the sentence at a specific character index within a text.
 */
export function extractSentenceAt(
  text: string,
  index: number,
): { text: string; start: number; end: number } {
  if (!text || index < 0 || index >= text.length) return { text: '', start: 0, end: 0 }
  const start = findSentenceStart(text, index)
  const end = findSentenceEnd(text, index)
  return { text: text.slice(start, end).trim(), start, end }
}

/**
 * Expands a range within a text to meet a minimum length, expanding both forward and backward.
 * Respects hard boundaries provided (e.g., existing links).
 */
export function expandRangeBidirectional(
  fullText: string,
  start: number,
  end: number,
  minLength: number,
  boundaryStart: number = 0,
  boundaryEnd: number = fullText.length,
): { text: string; start: number; end: number } {
  let currentStart = start
  let currentEnd = end

  while (currentEnd - currentStart < minLength) {
    if (currentEnd >= boundaryEnd && currentStart <= boundaryStart) break

    if (currentEnd < boundaryEnd) {
      currentEnd = findSentenceEnd(fullText, currentEnd + 1, boundaryEnd)
    }

    if (currentEnd - currentStart < minLength && currentStart > boundaryStart) {
      currentStart = findSentenceStart(fullText, currentStart - 1, boundaryStart)
    }
  }

  return {
    text: fullText.slice(currentStart, currentEnd).trim(),
    start: currentStart,
    end: currentEnd,
  }
}
