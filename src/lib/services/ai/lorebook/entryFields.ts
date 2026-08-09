/**
 * Normalizing the fields an agent writes onto a lorebook entry.
 *
 * `EntryRetrievalService` matches an entry's **name, its aliases and its keywords** against
 * the scene, all three, on word boundaries. So an alias equal to the entry's own name, or a
 * keyword repeating the name or an alias, can never add a match. Both are dropped here
 * rather than argued about in the prompt, because they are decidable without reading the
 * story. Judgement — how many keywords, whether a word is too common — stays in the prompt.
 *
 * Nothing is rejected: the entry lands and the tool reports what it dropped, so the model
 * sees the rule applied to its own output instead of losing the whole call over it.
 *
 * Plain TypeScript, no SDK or store imports.
 */

import { foldName } from '$lib/utils/text'

/** A term that was removed, with the reason to hand back to the model. */
export interface DroppedTerm {
  term: string
  reason: 'empty' | 'duplicate' | 'same-as-name' | 'same-as-alias'
}

export interface CleanedField {
  value: string[]
  dropped: DroppedTerm[]
}

/**
 * Drop empties, self-references and duplicates from a list of alternative names.
 *
 * Comparison is `foldName`, which folds spelling but keeps articles: `"Citadel"` and
 * `"citadel"` are one alias, `"The Citadel"` is a second one, because as a trigger it is a
 * different phrase. The spelling kept is the one written first.
 */
export function cleanAliases(name: string, aliases: string[] | undefined): CleanedField {
  const entryName = foldName(name)
  const seen = new Set<string>()
  const value: string[] = []
  const dropped: DroppedTerm[] = []

  for (const alias of aliases ?? []) {
    const normalized = foldName(alias)
    if (!normalized) {
      dropped.push({ term: alias, reason: 'empty' })
    } else if (normalized === entryName) {
      dropped.push({ term: alias, reason: 'same-as-name' })
    } else if (seen.has(normalized)) {
      dropped.push({ term: alias, reason: 'duplicate' })
    } else {
      seen.add(normalized)
      value.push(alias.trim())
    }
  }

  return { value, dropped }
}

/**
 * Drop empties, duplicates, and anything the name or an alias already matches.
 *
 * Takes the *cleaned* aliases: a keyword is redundant against the aliases that will
 * actually be stored, not against the ones that were asked for.
 */
export function cleanKeywords(
  name: string,
  aliases: string[],
  keywords: string[] | undefined,
): CleanedField {
  const entryName = foldName(name)
  const aliasSet = new Set(aliases.map(foldName).filter(Boolean))
  const seen = new Set<string>()
  const value: string[] = []
  const dropped: DroppedTerm[] = []

  for (const keyword of keywords ?? []) {
    const normalized = foldName(keyword)
    if (!normalized) {
      dropped.push({ term: keyword, reason: 'empty' })
    } else if (normalized === entryName) {
      dropped.push({ term: keyword, reason: 'same-as-name' })
    } else if (aliasSet.has(normalized)) {
      dropped.push({ term: keyword, reason: 'same-as-alias' })
    } else if (seen.has(normalized)) {
      dropped.push({ term: keyword, reason: 'duplicate' })
    } else {
      seen.add(normalized)
      value.push(keyword.trim())
    }
  }

  return { value, dropped }
}

const REASON_TEXT: Record<DroppedTerm['reason'], string> = {
  empty: 'empty',
  duplicate: 'listed twice',
  'same-as-name': 'the entry name already matches it',
  'same-as-alias': 'an alias already matches it',
}

/**
 * One sentence naming what was dropped, or null when nothing was.
 *
 * Returned in the tool result rather than logged: the point is that the model reads it.
 */
export function describeDropped(aliases: DroppedTerm[], keywords: DroppedTerm[]): string | null {
  const parts: string[] = []
  for (const { term, reason } of aliases) {
    parts.push(`alias "${term}" (${REASON_TEXT[reason]})`)
  }
  for (const { term, reason } of keywords) {
    parts.push(`keyword "${term}" (${REASON_TEXT[reason]})`)
  }
  if (parts.length === 0) return null
  return `Dropped as redundant: ${parts.join(', ')}. Entry name, aliases and keywords are all matched against the scene, so a term that repeats another one can never add a match.`
}
