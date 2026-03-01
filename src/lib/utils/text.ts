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
  // We strictly forbid double newlines (\\n\\n) to prevent crossing paragraph boundaries.
  const fuzzySeparator = '(?:[^a-zA-Z0-9\\n]|\\n(?!\\n))*?'

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
