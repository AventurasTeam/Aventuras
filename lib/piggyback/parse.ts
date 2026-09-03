import { jsonrepair } from 'jsonrepair'

import type { StoryEntry } from '@/lib/db'

import {
  STATE_ROOT_TAG,
  STATE_TAGS,
  SUGGESTION_ITEM_TAG,
  SUGGESTIONS_ROOT_TAG,
  TRAILING_ROOT_TAGS,
} from './tags'
import { VISUAL_CHANGE_TYPES } from './types'
import type {
  ItemTransfer,
  SuggestionRef,
  ParseFieldFailure,
  ParsedStateBlock,
  ParsedTransfers,
  ParseStateBlockResult,
  ParseSuggestionsBlockResult,
  StackableTransfer,
  VisualChangeNote,
  VisualChangeType,
} from './types'

function isVisualChangeType(value: string): value is VisualChangeType {
  return (VISUAL_CHANGE_TYPES as readonly string[]).includes(value)
}

// Unterminated recovery must stop at the next sibling block — otherwise one
// block's markup bleeds into the other's fields (C2).
function boundedEnd(raw: string, from: number, selfTag: string): number {
  const siblings = TRAILING_ROOT_TAGS.filter((t) => t !== selfTag)
    .map((t) => raw.indexOf(`<${t}>`, from))
    .filter((i) => i !== -1)
  return siblings.length === 0 ? raw.length : Math.min(...siblings)
}

// Segment isolation: extract the raw inner text of one top-level tag from a
// well-formed-or-truncated outer block. Returns undefined if the OPEN tag
// itself is missing (nothing to attempt); returns the inner text (possibly
// truncated / unterminated) if the open tag is present. `rootTag` bounds
// unterminated recovery at the enclosing block's sibling boundary.
function extractSegment(source: string, tag: string, rootTag: string): string | undefined {
  const openIdx = source.indexOf(`<${tag}>`)
  if (openIdx === -1) return undefined
  const start = openIdx + tag.length + 2
  const closeIdx = source.indexOf(`</${tag}>`, start)
  return closeIdx === -1
    ? source.slice(start, boundedEnd(source, start, rootTag))
    : source.slice(start, closeIdx)
}

function parseIdList(segment: string): string[] {
  return segment
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

// Coerces a possibly-decorated numeric segment ("  120, // seconds  ") down to
// a finite number via jsonrepair. Narrow use — jsonrepair coerces this one
// scalar leaf's text, it never repairs the surrounding XML structure (see
// docs/memory/piggyback.md → Parse strategy and failure recovery).
function parseNumeric(segment: string): number {
  const trimmed = segment.trim()
  const direct = Number(trimmed)
  if (Number.isFinite(direct)) return direct
  const repaired = JSON.parse(jsonrepair(`[${trimmed}]`)) as unknown[]
  const value = repaired[0]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`not a finite number: ${JSON.stringify(segment)}`)
  }
  return value
}

// key="value" pairs from a tag's attribute region (no surrounding < / >).
function parseAttributes(attrText: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /(\w+)="([^"]*)"/g
  for (const match of attrText.matchAll(re)) {
    const [, key, value] = match
    if (key !== undefined && value !== undefined) attrs[key] = value
  }
  return attrs
}

// A segment that has real content but yields zero structured entries is a
// truncation/malformation, not a legitimate "nothing to report" — an empty or
// whitespace-only segment (self-closed tag) is legitimate and yields [].
function assertNotTruncated(segment: string, extractedCount: number, tagLabel: string): void {
  if (segment.trim().length > 0 && extractedCount === 0) {
    throw new Error(`${tagLabel}: content present but no well-formed entries extracted`)
  }
}

// <entity id="..." type="...">text</entity> — full-replace visual change,
// one entry per changed category (docs/memory/piggyback.md → Trailing block format).
function parseVisualChanges(segment: string): VisualChangeNote[] {
  const notes: VisualChangeNote[] = []
  const re = /<entity\s+([^>]*)>([\s\S]*?)<\/entity>/g
  for (const match of segment.matchAll(re)) {
    const [, attrText, text] = match
    if (attrText === undefined || text === undefined) continue
    const attrs = parseAttributes(attrText)
    if (attrs.id === undefined || attrs.type === undefined || !isVisualChangeType(attrs.type))
      continue
    notes.push({ id: attrs.id, type: attrs.type, text: text.trim() })
  }
  assertNotTruncated(segment, notes.length, 'visual_changes')
  return notes
}

// <item id="..." to="..." from="..." slot="..." /> and
// <stackable key="..." amount="..." to="..." from="..." /> — self-closing,
// attribute-only. Both reference only already-existing entities.
function parseTransfers(segment: string): ParsedTransfers {
  const items: ItemTransfer[] = []
  const itemRe = /<item\s+([^>]*)\/?>/g
  for (const match of segment.matchAll(itemRe)) {
    const [, attrText] = match
    if (attrText === undefined) continue
    const attrs = parseAttributes(attrText)
    if (attrs.id === undefined) continue
    const slot = attrs.slot === 'equipped_items' ? 'equipped_items' : 'inventory'
    items.push({
      id: attrs.id,
      slot,
      ...(attrs.to !== undefined ? { to: attrs.to } : {}),
      ...(attrs.from !== undefined ? { from: attrs.from } : {}),
    })
  }

  const stackables: StackableTransfer[] = []
  const stackableRe = /<stackable\s+([^>]*)\/?>/g
  for (const match of segment.matchAll(stackableRe)) {
    const [, attrText] = match
    if (attrText === undefined) continue
    const attrs = parseAttributes(attrText)
    if (attrs.key === undefined || attrs.amount === undefined) continue
    const amount = Number(attrs.amount)
    if (!Number.isFinite(amount)) continue
    stackables.push({
      key: attrs.key,
      amount,
      ...(attrs.to !== undefined ? { to: attrs.to } : {}),
      ...(attrs.from !== undefined ? { from: attrs.from } : {}),
    })
  }

  assertNotTruncated(segment, items.length + stackables.length, 'transfers')
  return { items, stackables }
}

type FieldParser = {
  field: keyof ParsedStateBlock
  tag: string
  parse: (segment: string) => unknown
}

const FIELD_PARSERS: readonly FieldParser[] = [
  { field: 'sceneEntities', tag: STATE_TAGS.sceneEntities, parse: parseIdList },
  { field: 'currentLocation', tag: STATE_TAGS.currentLocation, parse: (s) => s.trim() },
  { field: 'worldTimeDelta', tag: STATE_TAGS.worldTimeDelta, parse: parseNumeric },
  { field: 'visualChanges', tag: STATE_TAGS.visualChanges, parse: parseVisualChanges },
  { field: 'transfers', tag: STATE_TAGS.transfers, parse: parseTransfers },
  { field: 'summary', tag: STATE_TAGS.summary, parse: (s) => s.trim() },
]

// Segment isolation + per-field best-effort parse: one failing top-level tag
// never blocks another (docs/memory/piggyback.md, C2 contract). Called on the
// FULL raw model output (prose + trailing block) — extracts <state> first.
export function parseStateBlock(raw: string): ParseStateBlockResult {
  const stateSegment = extractSegment(raw, STATE_ROOT_TAG, STATE_ROOT_TAG)
  if (stateSegment === undefined) return { block: {}, failures: [], blockFound: false }

  const block: ParsedStateBlock = {}
  const failures: ParseFieldFailure[] = []

  for (const { field, tag, parse } of FIELD_PARSERS) {
    const segment = extractSegment(stateSegment, tag, STATE_ROOT_TAG)
    if (segment === undefined) continue
    try {
      const value = parse(segment)
      // FIELD_PARSERS correlates each `field` with a `parse` producing its
      // matching value type by construction, but that pairing is erased once
      // collected into one array — narrower than `any`, still an intentional
      // escape hatch for a heterogeneous field-descriptor list.
      ;(block as Record<string, unknown>)[field] = value
    } catch (e) {
      failures.push({ field, detail: e instanceof Error ? e.message : String(e) })
    }
  }

  // Deliberately stricter than assertNotTruncated's field-level rule: an empty
  // <visual_changes> reports "none", but there is no such thing as a turn with no
  // state, so an empty <state> means the same as a MISSING one — which already
  // fires the fallback. Left unrecorded it reads as a clean parse instead, and
  // suppresses the very recovery it needs (per-turn.ts -> piggybackOutcome).
  if (Object.keys(block).length === 0 && failures.length === 0)
    failures.push({
      field: 'state',
      detail:
        stateSegment.trim().length === 0
          ? 'block was empty or truncated at the open tag'
          : 'block content matched no known field tag',
    })

  return { block, failures, blockFound: true }
}

// <item category="cat1">complete prose</item> — one entry per chip slot.
// Independent of <state> by construction: a separate root-tag extraction, so
// neither block's failure can reach the other (C2).
export function parseSuggestionsBlock(raw: string): ParseSuggestionsBlockResult {
  const segment = extractSegment(raw, SUGGESTIONS_ROOT_TAG, SUGGESTIONS_ROOT_TAG)
  if (segment === undefined)
    return { items: [], blockFound: false, failed: false, malformedCount: 0 }

  const items: SuggestionRef[] = []
  const re = new RegExp(
    `<${SUGGESTION_ITEM_TAG}\\s+([^>]*)>([\\s\\S]*?)</${SUGGESTION_ITEM_TAG}>`,
    'g',
  )
  for (const match of segment.matchAll(re)) {
    const [, attrText, text] = match
    if (attrText === undefined || text === undefined) continue
    const attrs = parseAttributes(attrText)
    if (attrs.category === undefined) continue
    const trimmed = text.trim()
    if (trimmed.length === 0) continue
    items.push({ categoryRef: attrs.category, text: trimmed })
  }

  // Counted off opening tags rather than by incrementing in the loop above: an
  // item truncated mid-stream, or one with no attributes at all, never matches
  // the paired regex, so the loop never sees it to count. `[\s>]` after the tag
  // name catches both `<item ...>` and a bare `<item>` without matching a
  // longer tag that merely starts with the same letters.
  const opened = segment.match(new RegExp(`<${SUGGESTION_ITEM_TAG}[\\s>]`, 'g'))?.length ?? 0

  try {
    assertNotTruncated(segment, items.length, SUGGESTIONS_ROOT_TAG)
  } catch {
    return { items: [], blockFound: true, failed: true, malformedCount: opened }
  }
  return {
    items,
    blockFound: true,
    failed: false,
    malformedCount: Math.max(0, opened - items.length),
  }
}

// Separates narrative prose from every block the model appended. Each block's own
// span is EXCISED rather than the string being truncated at it, so prose on both
// sides survives a model that emitted the block out of position.
//
// Keyed on the close tag, not position: prose that mentions `<state>` in passing
// carries no `</state>`, so it is never mistaken for markup. An unclosed opener is
// still cut when nothing but markup follows it — that is a truncated stream, not prose.
type BlockSpan = { tag: string; start: number; end: number }

function findBlockSpan(raw: string, tag: string): BlockSpan | undefined {
  const close = `</${tag}>`
  const closeIdx = raw.lastIndexOf(close)
  if (closeIdx !== -1) {
    const start = raw.lastIndexOf(`<${tag}>`, closeIdx)
    return start === -1 ? undefined : { tag, start, end: closeIdx + close.length }
  }
  const start = raw.lastIndexOf(`<${tag}>`)
  if (start === -1) return undefined
  const rest = raw.slice(start + tag.length + 2).trimStart()
  if (rest !== '' && !rest.startsWith('<')) return undefined
  return { tag, start, end: boundedEnd(raw, start + 1, tag) }
}

export function stripTrailingBlocks(raw: string): {
  prose: string
  stateRaw?: string
  suggestionsRaw?: string
  /** A block sat before prose rather than after it — the prompt forbids it, and
   *  emission compliance is a watch item (docs/memory/piggyback.md). */
  outOfPosition?: true
} {
  const spans = TRAILING_ROOT_TAGS.map((tag) => findBlockSpan(raw, tag))
    .filter((s): s is BlockSpan => s !== undefined)
    .sort((a, b) => a.start - b.start)
  if (spans.length === 0) return { prose: raw }

  const kept: string[] = []
  let cursor = 0
  for (const span of spans) {
    kept.push(raw.slice(cursor, span.start))
    cursor = span.end
  }
  kept.push(raw.slice(cursor))

  const blockRaw = (tag: string): string | undefined => {
    const span = spans.find((s) => s.tag === tag)
    return span === undefined ? undefined : raw.slice(span.start, span.end).trim()
  }
  const stateRaw = blockRaw(STATE_ROOT_TAG)
  const suggestionsRaw = blockRaw(SUGGESTIONS_ROOT_TAG)

  return {
    prose: kept.join('').trim(),
    ...(stateRaw !== undefined ? { stateRaw } : {}),
    ...(suggestionsRaw !== undefined ? { suggestionsRaw } : {}),
    ...(kept.slice(1).some((segment) => segment.trim() !== '') ? { outOfPosition: true } : {}),
  }
}

/** Model-authored kinds — the only rows that can carry a trailing block. */
export const NARRATIVE_KINDS = new Set<StoryEntry['kind']>(['ai_reply', 'opening'])

/**
 * What a prompt consumer should read instead of `story_entries.content`. New rows hold
 * stripped prose already, but rows written before the write-path strip still carry their
 * trailing blocks, and feeding those back would hand a model its own markup as
 * narrative.
 *
 * Gated on kind because a closed pair anywhere in the string is excised: a
 * `user_action` quoting a whole `<state>…</state>` is prose, not markup.
 */
export function promptProse(entry: { kind: StoryEntry['kind']; content: string }): string {
  return NARRATIVE_KINDS.has(entry.kind) ? stripTrailingBlocks(entry.content).prose : entry.content
}
