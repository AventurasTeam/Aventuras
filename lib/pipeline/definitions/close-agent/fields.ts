import { boundVoice, clampEmbeddedText } from '@/lib/classifier'
import { dedupeTerms } from '@/lib/keyword-terms'
import { boundStateText } from '@/lib/piggyback'
import { CAST_SOFT_CAPS } from '@/lib/wizard'

import { sameValue } from './tool'

/** A text field as the model sent it, and as it would be stored. */
export type SentText = { readonly sent: string; readonly bounded: string }

export type BoundedField = 'description' | 'title' | 'voice' | 'standing'

/**
 * Each text as a pass bounds it, trimmed first, so updateEntity's Zod parse can't refuse it and the
 * embedder's ceiling holds (retrieval.md → What gets embedded per type).
 */
export const TEXT_BOUNDS: Readonly<Record<BoundedField, (text: string) => string>> = Object.freeze({
  description: (text: string) =>
    clampEmbeddedText({ name: '', description: text.trim() }).description,
  title: (text: string) => clampEmbeddedText({ name: text, description: '' }).name,
  voice: (text: string) => boundVoice(text.trim()),
  standing: (text: string) => boundStateText(text.trim()).text,
})

/** A blank text reads as omitted, since a model fills optional fields; else as sent and bounded. */
export function sentText(value: string | undefined, field: BoundedField): SentText | undefined {
  if (value === undefined || value.trim() === '') return undefined
  return { sent: value, bounded: TEXT_BOUNDS[field](value) }
}

/** Where a list the model escaped into one string joins its entries; a plain comma is no join. */
const LEAKED_JOIN = /"\s*,\s*"|\r\n|\r|\n/

/** The joined list's outer quote is left unpartnered at a piece's edge. */
function dropStrayQuote(piece: string): string {
  const trimmed = piece.trim()
  if (trimmed.split('"').length % 2 === 1) return trimmed
  if (trimmed.startsWith('"')) return trimmed.slice(1)
  return trimmed.endsWith('"') ? trimmed.slice(0, -1) : trimmed
}

function leakedEntries(entry: string): string[] {
  const pieces = entry.split(LEAKED_JOIN)
  return pieces.length === 1 ? pieces : pieces.map(dropStrayQuote)
}

/**
 * A list replaces the stored one whole, so an empty one reads as omitted; else split where the
 * model joined entries into one, so the soft cap counts each, then deduped.
 */
export function sentList(value: readonly string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined
  const list = dedupeTerms(value.flatMap(leakedEntries))
  return list.length === 0 ? undefined : list
}

/** The stored value equals the text as sent or as bounded: a user's longer text is no change. */
export function restatedText(stored: unknown, text: SentText): boolean {
  return sameValue(stored, text.sent) || sameValue(stored, text.bounded)
}

export function restatedList(stored: unknown, list: readonly string[]): boolean {
  return sameValue(stored, list)
}

export type CappedList = 'traits' | 'drives' | 'agenda'
void (CAST_SOFT_CAPS satisfies Readonly<Record<CappedList, number>>)

/** Over its cap and longer than the stored list, so a row already over its cap can shrink or swap. */
export function overSoftCap(sent: readonly string[], stored: unknown, cap: number): boolean {
  const storedLength = Array.isArray(stored) ? stored.length : 0
  return sent.length > cap && sent.length > storedLength
}

/** A rule refusal's reason: the cap, and to replace rather than add. */
export function softCapReason(list: CappedList, cap: number): string {
  return `${list} is over its soft cap of ${cap}: replace an entry rather than add one`
}
