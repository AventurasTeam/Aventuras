import { jsonrepair } from 'jsonrepair'

import type { StoryEntry } from '@/lib/db'
import { foldStackableKey } from '@/lib/keyword-terms'

import {
  DROP_TAG,
  isCreateHandle,
  RETRIEVAL_QUERY_ITEM_TAG,
  STATE_CREATE_TAGS,
  STATE_ROOT_TAG,
  STATE_TAGS,
  SUGGESTION_ITEM_TAG,
  SUGGESTIONS_ROOT_TAG,
  TRAILING_ROOT_TAGS,
  unwrapBracket,
} from './tags'
import { MAX_RETRIEVAL_QUERIES, VISUAL_CHANGE_TYPES } from './types'
import type {
  ConditionChange,
  ItemDrop,
  ItemTransfer,
  NewItemEmission,
  NewLocationEmission,
  NormalizedStateBlock,
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

// data-model.md → Stackable items: lowercase keys of at most 40 characters, and a
// transfer moves a positive whole count (a negative `to` would store a debt).
export function normalizeStackableTransfer(transfer: StackableTransfer): StackableTransfer | null {
  const key = foldStackableKey(transfer.key)
  if (key === '' || key.length > 40) return null
  if (!Number.isSafeInteger(transfer.amount) || transfer.amount <= 0) return null
  return { ...transfer, key }
}

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
  // Closing quote stays unconsumed so `from="c3"to="c1"` splits; a hyphen can't precede a key,
  // so a hyphenated key's tail is never read as its own key.
  const re = /(?:^|[^\w-])([\w-]+)="([^"]*)(?=")/g
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

// An entry's text holds no `<` that opens a tag, so a self-closed or unclosed entry can't swallow
// the next one, and only one path matches each `<`, so an unclosed opener's scan stays linear.
const ENTRY_TEXT = '[^<]*(?:<(?![A-Za-z/!?])[^<]*)*'
// One `\s`: as `\s+`, it and the attributes would split a run of spaces every way, quadratically.
const ATTRIBUTES = '\\s([^<>]*)'
const ENTITY_ENTRY = `<entity${ATTRIBUTES}>(${ENTRY_TEXT})</entity>`

// <entity id="..." type="...">text</entity> — full-replace visual change,
// one entry per changed category (docs/memory/piggyback.md → Trailing block format).
function parseVisualChanges(segment: string): VisualChangeNote[] {
  const notes: VisualChangeNote[] = []
  for (const match of segment.matchAll(new RegExp(ENTITY_ENTRY, 'g'))) {
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

// piggyback.md → Trailing block format. A blank condition is kept for apply.ts to refuse.
function parseConditions(segment: string): ConditionChange[] {
  const changes: ConditionChange[] = []
  for (const match of segment.matchAll(new RegExp(ENTITY_ENTRY, 'g'))) {
    const [, attrText, text] = match
    if (attrText === undefined || text === undefined) continue
    const { id } = parseAttributes(attrText)
    if (!id) continue
    changes.push({ id, text: text.trim() })
  }
  assertNotTruncated(segment, changes.length, 'conditions')
  return changes
}

/** What a field's parse kept out of the block, for the phase to log. */
type ParseNotes = Pick<ParseStateBlockResult, 'dropsElsewhere'>

// Self-closing, attribute-only <item>, <drop> and <stackable> (piggyback.md → Trailing block
// format). Item moves and drops share one document-order `seq`, which apply.ts follows.
function parseTransfers(segment: string, notes: ParseNotes): ParsedTransfers {
  const items: ItemTransfer[] = []
  const drops: ItemDrop[] = []
  const elsewhere: ParseNotes['dropsElsewhere'] = []
  let seq = 0
  // No `<` in the attributes, so a tag missing its `>` is lost rather than read into the next one.
  const moveRe = new RegExp(`<(item|${DROP_TAG})${ATTRIBUTES}\\/?>`, 'g')
  for (const match of segment.matchAll(moveRe)) {
    const [, tag, attrText] = match
    if (attrText === undefined) continue
    const attrs = parseAttributes(attrText)
    if (!attrs.id) continue
    const from = attrs.from !== undefined ? { from: attrs.from } : {}
    if (tag === DROP_TAG) {
      // piggyback.md → Trailing block format: put down somewhere else than the scene stays prose.
      if (attrs.to !== undefined && attrs.to.trim() !== '')
        elsewhere.push({ id: attrs.id, to: attrs.to })
      else drops.push({ id: attrs.id, ...from, seq: seq++ })
      continue
    }
    const slot = attrs.slot === 'equipped_items' ? 'equipped_items' : 'inventory'
    items.push({
      id: attrs.id,
      slot,
      ...(attrs.to !== undefined ? { to: attrs.to } : {}),
      ...from,
      seq: seq++,
    })
  }

  const stackables: StackableTransfer[] = []
  const stackableRe = new RegExp(`<stackable${ATTRIBUTES}\\/?>`, 'g')
  for (const match of segment.matchAll(stackableRe)) {
    const [, attrText] = match
    if (attrText === undefined) continue
    const attrs = parseAttributes(attrText)
    if (attrs.key === undefined || attrs.amount === undefined) continue
    const transfer = normalizeStackableTransfer({
      key: attrs.key,
      amount: Number(attrs.amount),
      ...(attrs.to !== undefined ? { to: attrs.to } : {}),
      ...(attrs.from !== undefined ? { from: attrs.from } : {}),
    })
    if (transfer !== null) stackables.push(transfer)
  }

  // A drop kept out for its `to` was whole, so it doesn't read as a cut-off field.
  const whole = items.length + drops.length + elsewhere.length + stackables.length
  assertNotTruncated(segment, whole, 'transfers')
  notes.dropsElsewhere.push(...elsewhere)
  return { items, stackables, drops }
}

// Total by contract, the only parser that never raises: recovering an optional hint via a
// full extra structured call would invert that call's cost — never call assertNotTruncated.
// Returns undefined, not [], so an otherwise-empty block reads empty and the fallback fires.
function parseRetrievalQueries(segment: string): string[] | undefined {
  const seen = new Set<string>()
  const out: string[] = []
  const re = new RegExp(
    `<${RETRIEVAL_QUERY_ITEM_TAG}>(${ENTRY_TEXT})</${RETRIEVAL_QUERY_ITEM_TAG}>`,
    'g',
  )
  for (const match of segment.matchAll(re)) {
    const text = match[1]?.trim()
    if (text === undefined || text === '' || seen.has(text)) continue
    seen.add(text)
    out.push(text)
    if (out.length === MAX_RETRIEVAL_QUERIES) break
  }
  return out.length === 0 ? undefined : out
}

type FieldParser = {
  field: keyof ParsedStateBlock
  tag: string
  parse: (segment: string, notes: ParseNotes) => unknown
}

const FIELD_PARSERS: readonly FieldParser[] = [
  { field: 'sceneEntities', tag: STATE_TAGS.sceneEntities, parse: parseIdList },
  { field: 'currentLocation', tag: STATE_TAGS.currentLocation, parse: (s) => s.trim() },
  { field: 'worldTimeDelta', tag: STATE_TAGS.worldTimeDelta, parse: parseNumeric },
  { field: 'visualChanges', tag: STATE_TAGS.visualChanges, parse: parseVisualChanges },
  { field: 'conditions', tag: STATE_TAGS.conditions, parse: parseConditions },
  { field: 'transfers', tag: STATE_TAGS.transfers, parse: parseTransfers },
  { field: 'summary', tag: STATE_TAGS.summary, parse: (s) => s.trim() },
  { field: 'retrievalQueries', tag: STATE_TAGS.retrievalQueries, parse: parseRetrievalQueries },
]

// No `<` in attributes or content, so a create the stream cut off can't swallow later tags.
function createTagPattern(tag: string): RegExp {
  return new RegExp(`<${tag}(\\s[^<>]*?)?(?:/>|>([^<]*)</${tag}>)`, 'g')
}

function openedTagCount(segment: string, tag: string): number {
  return segment.match(new RegExp(`<${tag}(?:[\\s/>]|$)`, 'g'))?.length ?? 0
}

type ParsedCreates = {
  found: Pick<ParsedStateBlock, 'newLocations' | 'newItems'>
  /** Create tags opened at all, whole or not. */
  declared: number
  /** Create tags opened but never formed whole: cut off, an opener with no `>`, or a raw `<`
   *  in the attributes or the content. */
  unclosed: number
  /** Whole create tags dropped for attribute text that isn't entirely `key="value"` pairs. */
  badAttributes: number
}

// Linear: each pair starts at a whitespace run and ends at its closing quote.
const WELL_FORMED_ATTRIBUTES = /^(?:\s+[\w-]+="[^"]*")*\s*$/

const XML_ENTITIES = {
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  amp: '&',
} as const

// One pass, so `&amp;lt;` reads `&lt;`, not `<`. A create's name, description and condition only;
// `<conditions>` text is read raw.
function decodeEntities(text: string): string {
  return text.replace(
    /&(?:(quot|apos|lt|gt|amp)|#(\d+)|#x([0-9a-fA-F]+));/g,
    (match, named: keyof typeof XML_ENTITIES | undefined, decimal?: string, hex?: string) => {
      if (named !== undefined) return XML_ENTITIES[named]
      const code = decimal !== undefined ? Number(decimal) : parseInt(hex ?? '', 16)
      // NUL and a lone surrogate are no text, and past U+10FFFF fromCodePoint throws.
      const isText = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
      return isText ? String.fromCodePoint(code) : match
    },
  )
}

// Unlike FIELD_PARSERS' first-occurrence segments, a create tag repeats and carries attributes.
function readCreates(
  segment: string,
  tag: string,
): { creates: { attrs: Record<string, string>; text: string }[]; badAttributes: number } {
  const creates: { attrs: Record<string, string>; text: string }[] = []
  let badAttributes = 0
  for (const [, attrText = '', text = ''] of segment.matchAll(createTagPattern(tag))) {
    if (!WELL_FORMED_ATTRIBUTES.test(attrText)) badAttributes += 1
    else creates.push({ attrs: parseAttributes(attrText), text })
  }
  return { creates, badAttributes }
}

function parseCreates(segment: string): ParsedCreates {
  const locations = readCreates(segment, STATE_CREATE_TAGS.newLocation)
  const items = readCreates(segment, STATE_CREATE_TAGS.newItem)
  const condition = (attrs: Record<string, string>) =>
    attrs.condition !== undefined ? { condition: decodeEntities(attrs.condition) } : {}
  const newLocations = locations.creates.map(
    ({ attrs, text }): NewLocationEmission => ({
      handle: attrs.handle ?? '',
      name: decodeEntities(attrs.name ?? ''),
      description: decodeEntities(text.trim()),
      ...(attrs.parent !== undefined ? { parent: attrs.parent } : {}),
      ...condition(attrs),
    }),
  )
  const newItems = items.creates.map(
    ({ attrs, text }): NewItemEmission => ({
      handle: attrs.handle ?? '',
      name: decodeEntities(attrs.name ?? ''),
      description: decodeEntities(text.trim()),
      ...condition(attrs),
    }),
  )
  const wholeTags =
    newLocations.length + locations.badAttributes + newItems.length + items.badAttributes
  const declared =
    openedTagCount(segment, STATE_CREATE_TAGS.newLocation) +
    openedTagCount(segment, STATE_CREATE_TAGS.newItem)
  return {
    found: {
      ...(newLocations.length > 0 ? { newLocations } : {}),
      ...(newItems.length > 0 ? { newItems } : {}),
    },
    declared,
    unclosed: declared - wholeTags,
    badAttributes: locations.badAttributes + items.badAttributes,
  }
}

function bareHandle(handle: string): string {
  return unwrapBracket(handle.trim()).trim()
}

/** A block whose creates may omit `description`, as the fallback's structured reply can. */
type CreateBlockInput = Omit<ParsedStateBlock, 'newLocations' | 'newItems'> & {
  newLocations?: (Omit<NewLocationEmission, 'description'> & { description?: string })[]
  newItems?: (Omit<NewItemEmission, 'description'> & { description?: string })[]
}

/**
 * Drops, and counts, a create with no `new:` handle, a blank name, or a handle an earlier create
 * declared (locations before items); unwraps a bracketed handle, trims what it keeps, and drops a
 * blank parent or condition; a missing description reads as ''. Never a field failure itself: a
 * ref to a dropped handle fails in `substitutePiggybackIds`, so using one still fires the fallback.
 */
export function normalizeCreates(block: CreateBlockInput): {
  block: NormalizedStateBlock
  malformed: number
} {
  const { newLocations, newItems, ...rest } = block
  if (newLocations === undefined && newItems === undefined)
    return { block: rest as NormalizedStateBlock, malformed: 0 }

  const declared = new Set<string>()
  let malformed = 0
  const accepts = (handle: string, name: string): boolean => {
    if (!isCreateHandle(handle) || name === '' || declared.has(handle)) {
      malformed += 1
      return false
    }
    declared.add(handle)
    return true
  }
  const conditionOf = (create: { condition?: string }) => {
    const condition = create.condition?.trim() ?? ''
    return condition !== '' ? { condition } : {}
  }
  const locations = (newLocations ?? []).flatMap((create): NewLocationEmission[] => {
    const handle = bareHandle(create.handle)
    const name = create.name.trim()
    if (!accepts(handle, name)) return []
    const parent = create.parent?.trim() ?? ''
    return [
      {
        handle,
        name,
        description: create.description?.trim() ?? '',
        ...(parent !== '' ? { parent } : {}),
        ...conditionOf(create),
      },
    ]
  })
  const items = (newItems ?? []).flatMap((create): NewItemEmission[] => {
    const handle = bareHandle(create.handle)
    const name = create.name.trim()
    return accepts(handle, name)
      ? [{ handle, name, description: create.description?.trim() ?? '', ...conditionOf(create) }]
      : []
  })
  const normalized = {
    ...rest,
    ...(locations.length > 0 ? { newLocations: locations } : {}),
    ...(items.length > 0 ? { newItems: items } : {}),
  }
  return { block: normalized as NormalizedStateBlock, malformed }
}

function stateClosed(raw: string): boolean {
  return raw.indexOf(`</${STATE_ROOT_TAG}>`, raw.indexOf(`<${STATE_ROOT_TAG}>`)) !== -1
}

function emptyBlockDetail(
  stateSegment: string,
  hasCreates: boolean,
  malformedCreates: number,
): string {
  if (stateSegment.trim().length === 0) return 'block was empty or truncated at the open tag'
  if (hasCreates) return 'block held only creates'
  return malformedCreates > 0
    ? 'block held only malformed creates'
    : 'block content matched no known field tag'
}

// Segment isolation + per-field best-effort parse: one failing top-level tag
// never blocks another (docs/memory/piggyback.md, C2 contract). Called on the
// FULL raw model output (prose + trailing block) — extracts <state> first.
export function parseStateBlock(raw: string): ParseStateBlockResult {
  const stateSegment = extractSegment(raw, STATE_ROOT_TAG, STATE_ROOT_TAG)
  if (stateSegment === undefined)
    return {
      block: normalizeCreates({}).block,
      failures: [],
      blockFound: false,
      malformedCreates: 0,
      dropsElsewhere: [],
      dropsCutOff: [],
    }

  const block: ParsedStateBlock = {}
  const failures: ParseFieldFailure[] = []
  const notes: ParseNotes = { dropsElsewhere: [] }

  for (const { field, tag, parse } of FIELD_PARSERS) {
    const segment = extractSegment(stateSegment, tag, STATE_ROOT_TAG)
    if (segment === undefined) continue
    try {
      const value = parse(segment, notes)
      // Object.keys below judges the block empty, so assigning an undefined key would
      // make a block carrying nothing else read as a clean parse and lose its fallback.
      if (value === undefined) {
        continue
      }
      // FIELD_PARSERS correlates each `field` with a `parse` producing its
      // matching value type by construction, but that pairing is erased once
      // collected into one array — narrower than `any`, still an intentional
      // escape hatch for a heterogeneous field-descriptor list.
      ;(block as Record<string, unknown>)[field] = value
    } catch (e) {
      failures.push({ field, detail: e instanceof Error ? e.message : String(e) })
    }
  }

  const creates = parseCreates(stateSegment)
  const normalized = normalizeCreates({ ...block, ...creates.found })
  const malformedCreates = creates.unclosed + creates.badAttributes + normalized.malformed

  // A cut-off stream may have lost the tags that name a create (current_location, transfers), even
  // if every create tag is whole, so the fallback fires; a closed block only counts malformed ones.
  if (creates.declared > 0 && !stateClosed(raw))
    failures.push({ field: 'state', detail: 'block with creates cut off' })

  // Deliberately stricter than assertNotTruncated's field-level rule: an empty
  // <visual_changes> reports "none", but there is no such thing as a turn with no
  // state, so an empty <state> means the same as a MISSING one — which already
  // fires the fallback. Left unrecorded it reads as a clean parse instead, and
  // suppresses the very recovery it needs (per-turn.ts -> piggybackOutcome).
  // Creates don't count: only another field can keep one, so creates alone change nothing.
  const { newLocations, newItems, ...fields } = normalized.block
  if (Object.keys(fields).length === 0 && failures.length === 0)
    failures.push({
      field: 'state',
      detail: emptyBlockDetail(
        stateSegment,
        newLocations !== undefined || newItems !== undefined,
        malformedCreates,
      ),
    })

  // Held, not landed at the place the scene left: a closed block naming no place means the scene
  // stays, but a cut one may have lost it. A cut after <current_location> keeps them. Failed like a
  // cut with creates, so the fallback fires to resolve the scene and put them down.
  const transfers = normalized.block.transfers
  const holdDrops =
    !stateClosed(raw) && normalized.block.currentLocation === undefined && transfers !== undefined
  const dropsCutOff = holdDrops ? transfers.drops : []
  if (dropsCutOff.length > 0 && !failures.some((f) => f.field === 'state'))
    failures.push({ field: 'state', detail: 'block with drops cut off' })
  const kept =
    holdDrops && dropsCutOff.length > 0
      ? { ...normalized.block, transfers: { ...transfers, drops: [] } }
      : normalized.block

  return {
    block: kept,
    failures,
    blockFound: true,
    malformedCreates,
    dropsElsewhere: notes.dropsElsewhere,
    dropsCutOff,
  }
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
    `<${SUGGESTION_ITEM_TAG}${ATTRIBUTES}>(${ENTRY_TEXT})</${SUGGESTION_ITEM_TAG}>`,
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

function trailingBlockSpans(raw: string): BlockSpan[] {
  return TRAILING_ROOT_TAGS.map((tag) => findBlockSpan(raw, tag))
    .filter((s): s is BlockSpan => s !== undefined)
    .sort((a, b) => a.start - b.start)
}

/**
 * Where the server cut a reply it stopped at `length` (generation-pipeline.md → Cut-off replies):
 * `inBlock` once a trailing block had begun. A root opener cut mid-name is removed from `content`.
 */
export function readCutOffReply(raw: string): { content: string; inBlock: boolean } {
  // `<sta` opens no span findBlockSpan can see, so the fragment alone says a block had begun.
  const lt = raw.lastIndexOf('<')
  if (lt !== -1) {
    const fragment = raw.slice(lt + 1)
    if (TRAILING_ROOT_TAGS.some((tag) => tag.startsWith(fragment)))
      return { content: raw.slice(0, lt), inBlock: true }
  }
  const spans = trailingBlockSpans(raw)
  if (spans.length === 0) return { content: raw, inBlock: false }
  // Prose after the last block, as after one emitted out of position, is where the cut fell.
  const end = Math.max(...spans.map((span) => span.end))
  return { content: raw, inBlock: raw.slice(end).trim() === '' }
}

export function stripTrailingBlocks(raw: string): {
  prose: string
  stateRaw?: string
  suggestionsRaw?: string
  /** A block sat before prose rather than after it — the prompt forbids it, and
   *  emission compliance is a watch item (docs/memory/piggyback.md). */
  outOfPosition?: true
} {
  const spans = trailingBlockSpans(raw)
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
