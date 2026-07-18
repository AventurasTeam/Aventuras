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

export { buildTextSegments, type LintSpan, type TextSegment } from './segments'
