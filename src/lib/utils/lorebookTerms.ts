import type { Entry, EntryInjection, VaultLorebookEntry } from '$lib/types'
import { uniqueTerms } from './text'

/** The injection with its keywords deduped by `termKey`. */
export function uniqueInjectionTerms(injection: EntryInjection): EntryInjection {
  return { ...injection, keywords: uniqueTerms(injection.keywords) }
}

/**
 * An entry, or an update to one, with its aliases and injection keywords deduped. A field the
 * update leaves out stays out, and a missing injection stays missing — an imported file can
 * omit it, and it must still store as NULL.
 */
export function withUniqueEntryTerms<T extends Partial<Pick<Entry, 'aliases' | 'injection'>>>(
  entry: T,
): T {
  const out = { ...entry }
  if (out.aliases !== undefined) out.aliases = uniqueTerms(out.aliases)
  if (out.injection) out.injection = uniqueInjectionTerms(out.injection)
  return out
}

/** A vault lorebook entry with its aliases and keywords deduped; an absent list reads as `[]`. */
export function withUniqueVaultEntryTerms(entry: VaultLorebookEntry): VaultLorebookEntry {
  return { ...entry, keywords: uniqueTerms(entry.keywords), aliases: uniqueTerms(entry.aliases) }
}
