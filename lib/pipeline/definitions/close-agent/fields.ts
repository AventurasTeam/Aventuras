import { boundVoice, clampEmbeddedText } from '@/lib/classifier'
import { dedupeTerms } from '@/lib/keyword-terms'
import { boundStateText } from '@/lib/piggyback'
import { CAST_SOFT_CAPS } from '@/lib/wizard'

import { sameValue } from './tool'

/** A text field as the model sent it, and as it would be stored. */
export type SentText = { readonly sent: string; readonly bounded: string }

/** A list as the model sent it, that list deduped, and the entries it holds: what would be stored. */
export type SentList = {
  readonly raw: readonly string[]
  readonly deduped: readonly string[]
  readonly entries: readonly string[]
}

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

function stringList(json: string): string[] | undefined {
  try {
    const parsed: unknown = JSON.parse(json)
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
      ? parsed
      : undefined
  } catch {
    return undefined
  }
}

const BRACKETED = /^\[[\s\S]*\]$/

/**
 * A list the model escaped into one string, read by parsing it once its edge quotes and brackets
 * are restored, then again while an item unescapes further. Prose with its own quotes won't parse,
 * a single quoted entry stays whole unless it came in brackets, as a one-entry list, a decoded
 * entry keeps its own brackets, and a list of blanks holds no entry.
 */
function joinedList(entry: string, bracketed = false): string[] | undefined {
  const trimmed = entry.trim()
  const body = trimmed.replace(/^\[/, '').replace(/\]$/, '').trim()
  const open = body.startsWith('"') ? '' : '"'
  const close = body.endsWith('"') && !body.endsWith('\\"') ? '' : '"'
  const list = stringList(`[${open}${body}${close}]`)
  if (list === undefined) return undefined
  // An empty list restores to [""], so it reads as a list of blanks.
  if (list.every((item) => item.trim() === '')) return []
  if (list.length > 1) return list
  const [only] = list
  if (only === undefined) return undefined
  if (only === body) return bracketed ? [trimmed] : undefined
  const inBrackets = bracketed || BRACKETED.test(trimmed)
  // Each pass parses a shorter string, so this ends. An item holding a raw line break won't parse
  // again, so a bracketed one stands as decoded.
  return joinedList(only, inBrackets) ?? (inBrackets ? list : undefined)
}

const LIST_MARKER = /^(?:[-*]|\d+\.)\s+/

/** A list entry never spans lines; a split entry's lines drop their list markers. */
function entryLines(entry: string): string[] {
  const lines = entry.split('\n')
  return lines.length === 1 ? lines : lines.map((line) => line.trim().replace(LIST_MARKER, ''))
}

const heldEntries = (entry: string): string[] =>
  joinedList(entry)?.flatMap(entryLines) ?? entryLines(entry)

/**
 * A list replaces the stored one whole, so an empty one reads as omitted; else as the entries it
 * holds, so the soft cap counts each one a model joined into a string, then deduped.
 */
export function sentList(value: readonly string[] | undefined): SentList | undefined {
  if (value === undefined) return undefined
  const entries = dedupeTerms(value.flatMap(heldEntries))
  return entries.length === 0 ? undefined : { raw: value, deduped: dedupeTerms(value), entries }
}

/** The stored value equals the text as sent or as bounded: a user's longer text is no change. */
export function restatedText(stored: unknown, text: SentText): boolean {
  return sameValue(stored, text.sent) || sameValue(stored, text.bounded)
}

/**
 * The stored list equals the list as sent, deduped or as the entries it holds: a stored joined
 * entry is no change, nor a stored list resent with its duplicates, but dropping one is.
 */
export function restatedList(stored: unknown, list: SentList): boolean {
  return [list.raw, list.deduped, list.entries].some((sent) => sameValue(stored, sent))
}

export type CappedList = 'traits' | 'drives' | 'agenda'
void (CAST_SOFT_CAPS satisfies Readonly<Record<CappedList, number>>)

/** Over its cap and longer than the stored list, so a row already over its cap can shrink or swap. */
export function overSoftCap(sent: readonly string[], stored: unknown, cap: number): boolean {
  const storedLength = Array.isArray(stored) ? stored.length : 0
  return sent.length > cap && sent.length > storedLength
}

/** A rule refusal's reason: the cap, and to replace rather than add. */
export function softCapReason(list: CappedList, sent?: SentList): string {
  const reason = `${list} is over its soft cap of ${CAST_SOFT_CAPS[list]}: replace an entry rather than add one`
  if (sent === undefined || sent.entries.length <= sent.deduped.length) return reason
  return `${reason} (read as ${sent.entries.length} entries: a list joined into one string holds one entry per item)`
}
