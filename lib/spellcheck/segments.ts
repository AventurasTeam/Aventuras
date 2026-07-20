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
    // Skip a span that starts inside an already-emitted one; overlapping lints
    // would otherwise duplicate the shared characters in the rendered output.
    if (span.start < cursor) continue
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
