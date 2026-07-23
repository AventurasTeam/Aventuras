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
  const lints = await getLinter().lint(text, {
    language: 'markdown',
  })

  return lints.filter((lint) => {
    if (lint.lint_kind() === 'Capitalization') {
      return false
    }

    if (lint.lint_kind() === 'Spelling') {
      const problem = lint.get_problem_text()
      const hasCapitalizedSuggestion = lint.suggestions().some((s) => {
        const replacement = s.get_replacement_text()
        return replacement.toLowerCase() === problem.toLowerCase() && replacement !== problem
      })
      if (hasCapitalizedSuggestion) {
        return false
      }
    }

    return true
  })
}

export { buildTextSegments, type LintSpan, type TextSegment } from './segments'
