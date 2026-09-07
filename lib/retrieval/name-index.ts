// matchTerms normalizes only its haystack, so every term producer must match that
// shape or the lookup silently misses — hence the rule in a shared barrel-free module.
import { normalizeTerm } from '@/lib/keyword-terms'

export { normalizeTerm }

export type EntityNameIndex = {
  /** lowercased, NFC-normalized entity names present in the branch */
  entityNames: ReadonlySet<string>
}

export function parseKeywords(raw: unknown): string[] {
  let parsed: unknown
  try {
    // Hand-edited rows must not fail the whole retrieval pass.
    parsed = typeof raw === 'string' ? JSON.parse(raw) : []
  } catch {
    return []
  }
  return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
}

export function entityNameIndexFrom(entities: readonly { name: string }[]): EntityNameIndex {
  const entityNames = new Set<string>()

  for (const entity of entities) {
    const term = normalizeTerm(entity.name)
    if (term === '') continue
    entityNames.add(term)
  }

  return { entityNames }
}

// Terms come from user-authored names/keywords, which may contain regex metacharacters.
function escape(term: string): string {
  return term.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

// Plain \b is ASCII-only — "Zoë" never matches. \p{L}/\p{N} lookarounds cover any
// script with letter/number boundaries.
function boundaryPattern(term: string): RegExp {
  return new RegExp(String.raw`(?<![\p{L}\p{N}_])${escape(term)}(?![\p{L}\p{N}_])`, 'u')
}

// Han, kana and hangul carry no inter-word delimiter, so boundary lookarounds never
// fire in their prose; substring is safe because their characters are morphemes.
// docs/memory/retrieval.md → Keyword scan surface.
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const LETTER = /\p{L}/u
// \s, not ' ': U+3000 IDEOGRAPHIC SPACE is the delimiter a CJK author actually types.
const ANY_SPACE = /\s/u

// Composed of those scripts, not merely containing one: a Latin term with one CJK
// character keeps boundary anchoring. Code-point iteration, so an astral ideograph
// counts once. A space is an author-supplied delimiter; one character carries no signal.
function usesSubstringMatch(term: string): boolean {
  const chars = [...term]
  if (chars.length < 2 || ANY_SPACE.test(term)) return false
  let sawUnspacedScript = false
  for (const char of chars) {
    if (UNSPACED_SCRIPT.test(char)) sawUnspacedScript = true
    else if (LETTER.test(char)) return false
  }
  return sawUnspacedScript
}

export function matchTerms(text: string, terms: Iterable<string>): string[] {
  // Terms are stored NFC-normalized; prose (LLM-authored) isn't guaranteed to
  // be, so the same rendered name can otherwise miss on codepoint mismatch.
  const haystack = text.toLowerCase().normalize('NFC')
  const hits: string[] = []
  for (const term of terms) {
    if (term === '') continue
    if (!haystack.includes(term)) continue
    if (usesSubstringMatch(term)) {
      hits.push(term)
      continue
    }
    // Boundary-anchored: a substring hit (e.g. "Mira" inside "miracle") would
    // wrongly fire Layer-A suppression / kw_boost on ordinary prose.
    if (boundaryPattern(term).test(haystack)) hits.push(term)
  }
  return hits
}
