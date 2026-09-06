export type NameKeywordIndex = {
  /** lowercased, NFC-normalized entity names present in the branch */
  entityNames: ReadonlySet<string>
  /** lowercased, NFC-normalized lore keywords present in the branch */
  loreKeywords: ReadonlySet<string>
}

// matchTerms NFC-normalizes and lowercases its haystack but leaves its terms
// untouched, so every producer of a term has to match that shape or the lookup
// silently misses.
export function normalizeTerm(s: string): string {
  return s.trim().toLowerCase().normalize('NFC')
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

export function nameKeywordIndexFrom(
  entities: readonly { name: string }[],
  lore: readonly { keywords: readonly string[] }[],
): NameKeywordIndex {
  const entityNames = new Set<string>()
  const loreKeywords = new Set<string>()

  for (const entity of entities) {
    const term = normalizeTerm(entity.name)
    if (term === '') continue
    entityNames.add(term)
  }

  for (const row of lore) {
    for (const keyword of row.keywords) {
      const term = normalizeTerm(keyword)
      if (term === '') continue
      loreKeywords.add(term)
    }
  }

  return { entityNames, loreKeywords }
}

// Terms come from user-authored names/keywords, which may contain regex metacharacters.
function escape(term: string): string {
  return term.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

// Plain \b is ASCII-only and misses accented/Cyrillic names entirely (e.g.
// "Zoë" never matches). \p{L}/\p{N} lookarounds cover any script with
// letter/number boundaries.
function boundaryPattern(term: string): RegExp {
  return new RegExp(String.raw`(?<![\p{L}\p{N}_])${escape(term)}(?![\p{L}\p{N}_])`, 'u')
}

// Han, kana and hangul supply no inter-word delimiter (Korean attaches particles
// straight onto nouns), so boundary lookarounds silently never fire inside their
// prose. Substring is safe for these scripts because their characters are
// morphemes — the "art" inside "start" risk boundaries exist to prevent is far
// lower. docs/memory/retrieval.md → Keyword scan surface.
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const LETTER = /\p{L}/u
// \s, not ' ': U+3000 IDEOGRAPHIC SPACE is the delimiter a CJK author actually
// types, so the ASCII space alone covers the wrong half of the set.
const ANY_SPACE = /\s/u

// Composed of those scripts, not merely containing one — a mostly-Latin term
// with a single CJK character must keep boundary anchoring. Iterated by code
// point so an astral ideograph counts as the one character it is rather than as
// two UTF-16 units. An internal space is an author-supplied delimiter, and one
// character appears inside too much to carry signal.
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
