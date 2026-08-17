import {
  STATE_ROOT_TAG,
  STATE_TAGS,
  SUGGESTION_ITEM_TAG,
  SUGGESTIONS_ROOT_TAG,
  TRAILING_ROOT_TAGS,
  type ParsedStateBlock,
  type SuggestionRef,
} from '@/lib/piggyback'

// Renders a narrative reply the way a taggedBlockReliable model would: prose,
// then the trailing blocks the piggyback path folds in-band. Tag names come
// from the app's own constants and the output is round-tripped through the
// app's real parsers in tagged-block.test.ts, so the mock cannot serve markup
// the app rejects.

export type NarrativeValue = {
  prose: string
  state?: ParsedStateBlock
  suggestions?: SuggestionRef[]
}

// Attribute values are ids, enum members and keys — none legitimately contain
// these. A quote ends the value early (parseAttributes matches
// /(\w+)="([^"]*)"/) and an angle bracket ends the whole tag (the surrounding
// entry regexes scan `[^>]*`), so both are dropped rather than escaped: the
// parser has no unescaping step to undo an entity reference.
function attr(value: string | number): string {
  return String(value).replace(/["<>]/g, '')
}

// Segment extraction is non-greedy to the first matching close tag, so a
// literal close tag in free text truncates the entry.
function text(value: string, closing: string): string {
  return value.split(`</${closing}>`).join('')
}

function tag(name: string, value: string, indent = '  '): string {
  return `${indent}<${name}>${value}</${name}>`
}

function renderVisualChanges(block: ParsedStateBlock): string | null {
  const changes = block.visualChanges ?? []
  if (changes.length === 0) return null
  const rows = changes.map(
    (c) =>
      `    <entity id="${attr(c.id)}" type="${attr(c.type)}">${text(c.text, 'entity')}</entity>`,
  )
  return `  <${STATE_TAGS.visualChanges}>\n${rows.join('\n')}\n  </${STATE_TAGS.visualChanges}>`
}

function renderTransfers(block: ParsedStateBlock): string | null {
  const items = block.transfers?.items ?? []
  const stackables = block.transfers?.stackables ?? []
  if (items.length === 0 && stackables.length === 0) return null

  const rows = [
    ...items.map((i) => {
      const to = i.to !== undefined ? ` to="${attr(i.to)}"` : ''
      const from = i.from !== undefined ? ` from="${attr(i.from)}"` : ''
      return `    <item id="${attr(i.id)}" slot="${attr(i.slot)}"${to}${from} />`
    }),
    ...stackables.map((s) => {
      const to = s.to !== undefined ? ` to="${attr(s.to)}"` : ''
      const from = s.from !== undefined ? ` from="${attr(s.from)}"` : ''
      return `    <stackable key="${attr(s.key)}" amount="${attr(s.amount)}"${to}${from} />`
    }),
  ]
  return `  <${STATE_TAGS.transfers}>\n${rows.join('\n')}\n  </${STATE_TAGS.transfers}>`
}

/**
 * An inner tag is emitted only when it carries content: the app's parser treats
 * "content present but nothing extractable" as a truncation failure, so an
 * empty `<visual_changes></visual_changes>` would report a parse failure rather
 * than "nothing to report".
 */
function stateLines(block: ParsedStateBlock): string[] {
  const lines: string[] = []

  const scene = block.sceneEntities ?? []
  if (scene.length > 0) lines.push(tag(STATE_TAGS.sceneEntities, scene.join(', ')))

  const location = block.currentLocation?.trim()
  if (location) lines.push(tag(STATE_TAGS.currentLocation, location))

  if (block.worldTimeDelta !== undefined)
    lines.push(tag(STATE_TAGS.worldTimeDelta, String(block.worldTimeDelta)))

  const visual = renderVisualChanges(block)
  if (visual) lines.push(visual)

  const transfers = renderTransfers(block)
  if (transfers) lines.push(transfers)

  const summary = block.summary?.trim()
  if (summary) lines.push(tag(STATE_TAGS.summary, text(summary, STATE_TAGS.summary)))

  return lines
}

export function hasStateContent(block: ParsedStateBlock | undefined): boolean {
  return block !== undefined && stateLines(block).length > 0
}

export function renderStateBlock(block: ParsedStateBlock): string {
  return `<${STATE_ROOT_TAG}>\n${stateLines(block).join('\n')}\n</${STATE_ROOT_TAG}>`
}

export function renderSuggestionsBlock(items: SuggestionRef[]): string {
  const rows = items.map(
    (i) =>
      `  <${SUGGESTION_ITEM_TAG} category="${attr(i.categoryRef)}">${text(i.text, SUGGESTION_ITEM_TAG)}</${SUGGESTION_ITEM_TAG}>`,
  )
  return `<${SUGGESTIONS_ROOT_TAG}>\n${rows.join('\n')}\n</${SUGGESTIONS_ROOT_TAG}>`
}

// stripTrailingBlocks cuts prose at the EARLIEST trailing root tag, so a root
// tag inside the prose would silently truncate the rendered reply.
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
