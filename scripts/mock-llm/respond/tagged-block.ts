import {
  DROP_TAG,
  RETRIEVAL_QUERY_ITEM_TAG,
  STATE_CREATE_TAGS,
  STATE_ROOT_TAG,
  STATE_TAGS,
  SUGGESTION_ITEM_TAG,
  SUGGESTIONS_ROOT_TAG,
  TRAILING_ROOT_TAGS,
  type ItemDrop,
  type ItemTransfer,
  type NewItemEmission,
  type NewLocationEmission,
  type ParsedStateBlock,
  type StackableTransfer,
  type SuggestionRef,
} from '@/lib/piggyback'

// Renders a narrative reply the way a taggedBlockReliable model would: prose,
// then the trailing blocks the piggyback path folds in-band. Tag names come
// from the app's own constants and the output is round-tripped through the
// app's real parsers in tagged-block.test.ts, so the mock cannot serve markup
// the app rejects.

/** A move as the mock's UI authors it (validate.ts), with no order: list order stands in. */
type AuthoredMove<T extends { seq: number }> = Omit<T, 'seq'> & { seq?: number }

/** A create as authored: validate.ts asks for no description, which the parser reads as ''. */
type AuthoredCreate<T extends { description: string }> = Omit<T, 'description'> & {
  description?: string
}

/** A block as authored, or as parsed back from a served reply ("Save reply as response"). */
export type AuthoredStateBlock = Omit<
  ParsedStateBlock,
  'transfers' | 'newLocations' | 'newItems'
> & {
  newLocations?: AuthoredCreate<NewLocationEmission>[]
  newItems?: AuthoredCreate<NewItemEmission>[]
  transfers?: {
    items: AuthoredMove<ItemTransfer>[]
    stackables: StackableTransfer[]
    drops?: AuthoredMove<ItemDrop>[]
  }
}

export type NarrativeValue = {
  prose: string
  state?: AuthoredStateBlock
  suggestions?: SuggestionRef[]
}

// Dropped, not escaped (ids/enums/keys never hold them): `"` ends a value early in
// parseAttributes, `>` ends the tag in every entry pattern, and `<` in the `[^<>]*` ones.
function attr(value: string | number): string {
  return String(value).replace(/["<>]/g, '')
}

// Round-trips the parser's entity decoding; `&` first, so an entity typed into the text survives.
function escaped(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Segment extraction is non-greedy to the first matching close tag, so a
// literal close tag in free text truncates the entry.
function text(value: string, closing: string): string {
  return value.split(`</${closing}>`).join('')
}

function tag(name: string, value: string, indent = '  '): string {
  return `${indent}<${name}>${value}</${name}>`
}

function list(name: string, rows: string[]): string | null {
  return rows.length === 0 ? null : `  <${name}>\n${rows.join('\n')}\n  </${name}>`
}

function renderVisualChanges(block: AuthoredStateBlock): string | null {
  return list(
    STATE_TAGS.visualChanges,
    (block.visualChanges ?? []).map(
      (c) =>
        `    <entity id="${attr(c.id)}" type="${attr(c.type)}">${text(c.text, 'entity')}</entity>`,
    ),
  )
}

function renderConditions(block: AuthoredStateBlock): string | null {
  return list(
    STATE_TAGS.conditions,
    (block.conditions ?? []).map(
      (c) =>
        `    <entity id="${attr(c.id)}">${text(c.text.replace(/[<>]/g, ''), 'entity')}</entity>`,
    ),
  )
}

function renderNewLocations(block: AuthoredStateBlock): string[] {
  const name = STATE_CREATE_TAGS.newLocation
  return (block.newLocations ?? []).map((c) => {
    const parent = c.parent !== undefined ? ` parent="${attr(c.parent)}"` : ''
    const condition = c.condition !== undefined ? ` condition="${escaped(c.condition)}"` : ''
    return `  <${name} handle="${attr(c.handle)}"${parent} name="${escaped(c.name)}"${condition}>${escaped(c.description ?? '')}</${name}>`
  })
}

function renderNewItems(block: AuthoredStateBlock): string[] {
  const name = STATE_CREATE_TAGS.newItem
  return (block.newItems ?? []).map((c) => {
    const condition = c.condition !== undefined ? ` condition="${escaped(c.condition)}"` : ''
    return `  <${name} handle="${attr(c.handle)}" name="${escaped(c.name)}"${condition}>${escaped(c.description ?? '')}</${name}>`
  })
}

// A move with no `seq` takes the one listed before it in its list, or `first` at the list's head.
function orderedRows<T extends { seq?: number }>(
  moves: readonly T[],
  first: number,
  row: (move: T) => string,
): { order: number; row: string }[] {
  let order = first
  return moves.map((move) => {
    order = move.seq ?? order
    return { order, row: row(move) }
  })
}

// Block order is `seq`; a drop at its list's head follows every item move, but not a drop listed
// below it. A tie keeps the item moves first, then list order.
function renderTransfers(block: AuthoredStateBlock): string | null {
  const items = block.transfers?.items ?? []
  const drops = block.transfers?.drops ?? []
  const stackables = block.transfers?.stackables ?? []
  const holders = (to: string | undefined, from: string | undefined) =>
    `${to !== undefined ? ` to="${attr(to)}"` : ''}${from !== undefined ? ` from="${attr(from)}"` : ''}`
  const itemRows = orderedRows(
    items,
    -Infinity,
    (i) => `    <item id="${attr(i.id)}" slot="${attr(i.slot)}"${holders(i.to, i.from)} />`,
  )
  const dropRows = orderedRows(
    drops,
    Math.min(
      Math.max(-Infinity, ...itemRows.map((r) => r.order)),
      drops.find((d) => d.seq !== undefined)?.seq ?? Infinity,
    ),
    (d) => `    <${DROP_TAG} id="${attr(d.id)}"${holders(undefined, d.from)} />`,
  )
  // Two -Infinity orders subtract to NaN, which sort reads as a tie.
  const moves = [...itemRows, ...dropRows].sort((a, b) => a.order - b.order)
  return list(STATE_TAGS.transfers, [
    ...moves.map((m) => m.row),
    ...stackables.map(
      (s) =>
        `    <stackable key="${attr(s.key)}" amount="${attr(s.amount)}"${holders(s.to, s.from)} />`,
    ),
  ])
}

function renderRetrievalQueries(block: AuthoredStateBlock): string | null {
  return list(
    STATE_TAGS.retrievalQueries,
    (block.retrievalQueries ?? []).map((q) =>
      tag(RETRIEVAL_QUERY_ITEM_TAG, text(q, RETRIEVAL_QUERY_ITEM_TAG), '    '),
    ),
  )
}

/**
 * An inner tag is emitted only with content: the parser reads "content present but nothing
 * extractable" as truncation, so an empty `<visual_changes></visual_changes>` reports a parse
 * failure, not "nothing to report". Tags follow the order the state-emission macro shows.
 */
function stateLines(block: AuthoredStateBlock): string[] {
  const lines: string[] = []
  const push = (line: string | null) => {
    if (line) lines.push(line)
  }

  const scene = block.sceneEntities ?? []
  if (scene.length > 0)
    lines.push(tag(STATE_TAGS.sceneEntities, text(scene.join(', '), STATE_TAGS.sceneEntities)))

  lines.push(...renderNewLocations(block))

  const location = block.currentLocation?.trim()
  if (location)
    lines.push(tag(STATE_TAGS.currentLocation, text(location, STATE_TAGS.currentLocation)))

  if (block.worldTimeDelta !== undefined)
    lines.push(tag(STATE_TAGS.worldTimeDelta, String(block.worldTimeDelta)))

  push(renderVisualChanges(block))
  push(renderConditions(block))
  lines.push(...renderNewItems(block))
  push(renderTransfers(block))

  const summary = block.summary?.trim()
  if (summary) lines.push(tag(STATE_TAGS.summary, text(summary, STATE_TAGS.summary)))

  push(renderRetrievalQueries(block))
  return lines
}

export function hasStateContent(block: AuthoredStateBlock | undefined): boolean {
  return block !== undefined && stateLines(block).length > 0
}

export function renderStateBlock(block: AuthoredStateBlock): string {
  const lines = stateLines(block)
  // An empty root reads to the app's parser as a truncated block, not as
  // "nothing to report" — the same reason stateLines omits empty inner tags.
  if (lines.length === 0) return ''
  return `<${STATE_ROOT_TAG}>\n${lines.join('\n')}\n</${STATE_ROOT_TAG}>`
}

export function renderSuggestionsBlock(items: SuggestionRef[]): string {
  const rows = items.map(
    (i) =>
      `  <${SUGGESTION_ITEM_TAG} category="${attr(i.categoryRef)}">${text(i.text, SUGGESTION_ITEM_TAG)}</${SUGGESTION_ITEM_TAG}>`,
  )
  return `<${SUGGESTIONS_ROOT_TAG}>\n${rows.join('\n')}\n</${SUGGESTIONS_ROOT_TAG}>`
}

// A fixture whose prose opens a root tag and the block then closes it would have the
// span between them excised from the rendered reply.
function safeProse(prose: string): string {
  return TRAILING_ROOT_TAGS.reduce((acc, t) => acc.split(`<${t}>`).join(`&lt;${t}&gt;`), prose)
}

export function renderNarrative(value: NarrativeValue): string {
  const parts = [safeProse(value.prose)]

  if (value.state && hasStateContent(value.state)) parts.push(renderStateBlock(value.state))

  if (value.suggestions && value.suggestions.length > 0)
    parts.push(renderSuggestionsBlock(value.suggestions))

  return parts.join('\n\n')
}
