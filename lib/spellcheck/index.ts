import { LocalLinter, Dialect, type Lint } from 'harper.js'
import { binaryInlined } from 'harper.js/binaryInlined'

let linter: LocalLinter | null = null

/**
 * Get or lazily initialize the spellcheck linter.
 * Uses the binaryInlined variant (WASM embedded as data URL).
 */
function getLinter(): LocalLinter {
  linter ??= new LocalLinter({
    binary: binaryInlined,
    dialect: Dialect.American,
  })
  return linter
}

/**
 * Lint narrative text using Harper.js (composer-only scope).
 * Returns an array of linting errors with spans, messages, and suggestions.
 */
export async function lintNarrativeText(text: string): Promise<Lint[]> {
  return getLinter().lint(text, {
    language: 'markdown',
  })
}

type LintSpan = { start: number; end: number }

type TextSegment =
  | { kind: 'plain'; text: string }
  | { kind: 'lint'; text: string; key: string; index: number }

/**
 * Splits `text` around `spans` (character ranges, e.g. Harper's `Lint.span()`).
 * `index` on a lint segment points back into the original `spans` array so
 * callers can look up the source Lint without carrying the WASM object
 * through this pure splitting logic.
 */
export function buildTextSegments(text: string, spans: readonly LintSpan[]): TextSegment[] {
  const ordered = spans
    .map((span, index) => ({ span, index }))
    .sort((a, b) => a.span.start - b.span.start)

  const segments: TextSegment[] = []
  let cursor = 0
  for (const { span, index } of ordered) {
    if (span.start > cursor) segments.push({ kind: 'plain', text: text.slice(cursor, span.start) })
    segments.push({
      kind: 'lint',
      text: text.slice(span.start, span.end),
      key: `${span.start}-${span.end}`,
      index,
    })
    cursor = Math.max(cursor, span.end)
  }
  if (cursor < text.length) segments.push({ kind: 'plain', text: text.slice(cursor) })
  return segments
}

export type { LintSpan, TextSegment }
