import type { Delta } from '@/lib/db'
import { t } from '@/lib/i18n'

import {
  HISTORY_LINK_TABLES,
  RETRIEVAL_COUNT,
  type HistoryLinkTable,
  type LinkSide,
} from './link-rows'

export const HISTORY_TABLES = ['entities', 'lore', 'threads', 'happenings'] as const
export type HistoryTable = (typeof HISTORY_TABLES)[number]

export const HISTORY_OPS = ['create', 'update', 'delete'] as const satisfies readonly Delta['op'][]

type Labels = Readonly<Record<string, () => string>>

// C4: the humanizer owns this vocabulary. A slice adding a delta-logged column adds its label.
const ENTITY: Labels = {
  name: () => t('history:field.name'),
  description: () => t('history:field.description'),
  status: () => t('history:field.status'),
  retiredReason: () => t('history:field.retiredReason'),
  injectionMode: () => t('history:field.injectionMode'),
  tags: () => t('history:field.tags'),
  keywords: () => t('history:field.keywords'),
  priority: () => t('history:field.priority'),
  nameCollisionFlag: () => t('history:field.nameCollisionFlag'),
  nameCollisionPartnerId: () => t('history:field.nameCollisionFlag'),
  nameCollisionReason: () => t('history:field.nameCollisionFlag'),
  state: () => t('history:field.state'),
  'state.visual': () => t('history:field.visual'),
  'state.visual.physique': () => t('history:field.physique'),
  'state.visual.face': () => t('history:field.face'),
  'state.visual.hair': () => t('history:field.hair'),
  'state.visual.eyes': () => t('history:field.eyes'),
  'state.visual.attire': () => t('history:field.attire'),
  'state.visual.distinguishing': () => t('history:field.distinguishing'),
  'state.traits': () => t('history:field.traits'),
  'state.drives': () => t('history:field.drives'),
  'state.voice': () => t('history:field.voice'),
  'state.current_location_id': () => t('history:field.currentLocation'),
  'state.equipped_items': () => t('history:field.equipped'),
  'state.inventory': () => t('history:field.carried'),
  'state.stackables': () => t('history:field.stackables'),
  'state.faction_id': () => t('history:field.faction'),
  'state.lastSeenAt': () => t('history:field.lastSeen'),
  'state.parent_location_id': () => t('history:field.parentLocation'),
  'state.condition': () => t('history:field.condition'),
  'state.at_location_id': () => t('history:field.atLocation'),
  'state.standing': () => t('history:field.standing'),
  'state.agenda': () => t('history:field.agenda'),
}

const LORE: Labels = {
  title: () => t('history:field.title'),
  body: () => t('history:field.body'),
  category: () => t('history:field.category'),
  tags: () => t('history:field.tags'),
  keywords: () => t('history:field.keywords'),
  injectionMode: () => t('history:field.injectionMode'),
  priority: () => t('history:field.priority'),
}

const THREAD: Labels = {
  title: () => t('history:field.title'),
  description: () => t('history:field.description'),
  category: () => t('history:field.category'),
  icon: () => t('history:field.icon'),
  status: () => t('history:field.status'),
  injectionMode: () => t('history:field.injectionMode'),
  triggeredAtEntryId: () => t('history:field.triggeredAt'),
  resolvedAtEntryId: () => t('history:field.resolvedAt'),
}

const HAPPENING: Labels = {
  title: () => t('history:field.title'),
  description: () => t('history:field.description'),
  category: () => t('history:field.category'),
  icon: () => t('history:field.icon'),
  temporal: () => t('history:field.temporal'),
  occurredAtEntryId: () => t('history:field.occurredAt'),
  commonKnowledge: () => t('history:field.commonKnowledge'),
}

const yourView = () => t('history:field.yourView')
const theirView = () => t('history:field.theirView')

// `kind` is a's view of b (data-model.md), so the tab's own view is `kind` only on side a.
const RELATIONSHIP_SIDE_A: Labels = { kind: yourView, inverseKind: theirView }
const RELATIONSHIP_SIDE_B: Labels = { kind: theirView, inverseKind: yourView }

const INVOLVEMENT: Labels = { role: () => t('history:field.role') }

const AWARENESS: Labels = {
  source: () => t('history:field.source'),
  decayResistance: () => t('history:field.decayResistance'),
  learnedAtEntryId: () => t('history:field.learnedAt'),
  retrievalCount: () => t('history:field.retrievalCount'),
}

const LABELS: Record<SidelessTable, Labels> = {
  entities: ENTITY,
  lore: LORE,
  threads: THREAD,
  happenings: HAPPENING,
  happening_involvements: INVOLVEMENT,
  happening_awareness: AWARENESS,
}

// A relationship's labels depend on the tab's side, so a lookup without one is a bug, not side a.
function labelsFor(table: HistoryTable | HistoryLinkTable, side?: LinkSide): Labels {
  if (table !== 'character_relationships') return LABELS[table]
  if (side === 'a') return RELATIONSHIP_SIDE_A
  if (side === 'b') return RELATIONSHIP_SIDE_B
  throw new Error('A relationship field label needs the tab side, a or b')
}

type SidelessTable = HistoryTable | Exclude<HistoryLinkTable, 'character_relationships'>

/** A link table's columns whose change lists a delta: each labelled one but the retrieval count. */
export function listedLinkColumns(table: HistoryLinkTable): string[] {
  const labels = table === 'character_relationships' ? RELATIONSHIP_SIDE_A : LABELS[table]
  return Object.keys(labels).filter((column) => column !== RETRIEVAL_COUNT)
}

function parentPath(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(0, dot)
}

/**
 * A field path's user-facing name: its nearest labelled ancestor, else the raw path. A
 * relationship row takes the tab's end of the pair as `side`; no other table takes one.
 */
export function fieldPathLabel(table: SidelessTable, path: string): string
export function fieldPathLabel(
  table: 'character_relationships',
  path: string,
  side: 'a' | 'b',
): string
export function fieldPathLabel(
  table: HistoryTable | HistoryLinkTable,
  path: string,
  side?: LinkSide,
): string {
  const labels = labelsFor(table, side)
  for (let current = path; current !== ''; current = parentPath(current)) {
    if (Object.hasOwn(labels, current)) return labels[current]()
  }
  return path
}

/** Field paths whose label contains `term`, so searching the summary's wording finds its rows. */
export function pathsMatchingLabel(table: SidelessTable, term: string): string[]
export function pathsMatchingLabel(
  table: 'character_relationships',
  term: string,
  side: 'a' | 'b',
): string[]
export function pathsMatchingLabel(
  table: HistoryTable | HistoryLinkTable,
  term: string,
  side?: LinkSide,
): string[] {
  const needle = term.trim().toLocaleLowerCase()
  if (needle === '') return []
  return Object.entries(labelsFor(table, side))
    .filter(([, label]) => label().toLocaleLowerCase().includes(needle))
    .map(([path]) => path)
}

const LINK_LABELS: Record<HistoryLinkTable, () => string> = {
  character_relationships: () => t('history:linkLabel.character_relationships'),
  happening_involvements: () => t('history:linkLabel.happening_involvements'),
  happening_awareness: () => t('history:linkLabel.happening_awareness'),
}

/** A link row's name on its History target line ("Relationship"). */
export function linkTableLabel(table: HistoryLinkTable): string {
  return LINK_LABELS[table]()
}

/** A removal row's target line: the label of the one link kind it held, or "Links" for several. */
export function removalTargetLabel(
  tables: readonly [HistoryLinkTable, ...HistoryLinkTable[]],
): string {
  return tables.length === 1 ? linkTableLabel(tables[0]) : t('history:linkLabel.links')
}

/** Link tables whose label starts a word with `term`, for the target-line search. */
export function linkLabelsMatching(term: string): HistoryLinkTable[] {
  const needle = term.trim().toLocaleLowerCase()
  if (needle === '') return []
  return HISTORY_LINK_TABLES.filter((table) => startsWithWord(LINK_LABELS[table](), needle))
}

// Every rendered spelling of an op (name, filter label, summary) that a search must match.
// `summary.modified` is excluded — unrendered "{{fields}}" would false-match; modifiedUnknown covers it.
const OP_LABELS: Record<Delta['op'], () => string[]> = {
  create: () => [
    t('history:op.create'),
    t('history:opFilter.create'),
    t('history:summary.created'),
  ],
  update: () => [
    t('history:op.update'),
    t('history:opFilter.update'),
    t('history:summary.modifiedUnknown'),
  ],
  delete: () => [
    t('history:op.delete'),
    t('history:opFilter.delete'),
    t('history:summary.deleted'),
  ],
}

// Word-start match only — "eat"/"date"/"let" must not hit "created"/"updated"/"deleted".
function startsWithWord(label: string, needle: string): boolean {
  return label
    .toLocaleLowerCase()
    .split(/\s+/)
    .some((word) => word.startsWith(needle))
}

/** Ops whose rendered label (op name, filter chip, or summary text) starts a word with `term`. */
export function opsMatchingLabel(term: string): Delta['op'][] {
  const needle = term.trim().toLocaleLowerCase()
  if (needle === '') return []
  return HISTORY_OPS.filter((op) => OP_LABELS[op]().some((label) => startsWithWord(label, needle)))
}

/** Joins an update summary's field labels ("Modified Traits, Drives"). */
export const SUMMARY_FIELD_SEPARATOR = ', '

// Stands in for an interpolated value, so a rendered summary splits around it.
const SLOT = '\u0000'

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Split at the slot rather than hard-coding the wording: a locale may put the value first.
function slotPattern(rendered: string): { pattern: RegExp; lead: string; tail: string } | null {
  const [lead, tail = ''] = rendered.split(SLOT).map((part) => part.trim())
  if (lead === '' && tail === '') return null
  const before = lead === '' ? '' : `${escapeRegExp(lead)}\\s+`
  const after = tail === '' ? '' : `\\s+${escapeRegExp(tail)}`
  return { pattern: new RegExp(`^${before}(.+?)${after}$`, 'iu'), lead, tail }
}

/** The field labels a typed update summary names, or null when `term` isn't worded as one. */
export function summaryFieldTerms(term: string): string[] | null {
  const summary = slotPattern(t('history:summary.modified', { fields: SLOT }))
  const fields = summary?.pattern.exec(term.trim())?.[1]
  if (fields == null) return null
  const labels = fields
    .split(SUMMARY_FIELD_SEPARATOR.trim())
    .map((label) => label.trim())
    .filter((label) => label !== '')
  return labels.length > 0 ? labels : null
}

/** The removals a term matches by their summary: all, those whose other end has no name, or one. */
export type RemovalSummaryTerm =
  | { kind: 'any' }
  | { kind: 'unknown' }
  | { kind: 'named'; name: string }

const collapseSpaces = (text: string) => text.trim().replace(/\s+/g, ' ')

/** `text` as a search compares it: trimmed, lower-cased, each whitespace run one space. */
export const searchText = (text: string) => collapseSpaces(text).toLocaleLowerCase()

/**
 * Whether `needle`, as `searchText` gives it, begins at a word of `text` and may run across
 * words: "when" and "removed when" start words of "Removed when", "moved" doesn't.
 */
export function startsAWord(text: string, needle: string): boolean {
  return needle !== '' && ` ${searchText(text)}`.includes(` ${needle}`)
}

// The name between lead and tail, maybe partial ("Removed when Ka" names Ka, "…Kael w" names Kael).
// With no lead, only a started tail makes a name, or any typed word would read as one.
function typedName(lead: string, tail: string, term: string): string | null {
  const before = lead === '' ? '' : `${escapeRegExp(lead)}\\s+`
  const partials = Array.from({ length: tail.length }, (_, i) => escapeRegExp(tail.slice(0, i + 1)))
  const started = tail === '' ? '' : `\\s+(?:${partials.reverse().join('|')})`
  const after = lead === '' || started === '' ? started : `(?:${started})?`
  return new RegExp(`^${before}(.+?)${after}$`, 'iu').exec(collapseSpaces(term))?.[1] ?? null
}

/**
 * A term read against the removal summary ("Removed when Kael was deleted"): typed through a name
 * → `named`; a word run of its wording → `any`; the unknown-end wording typed whole → `unknown`.
 */
export function removalSummaryTerm(term: string): RemovalSummaryTerm | null {
  const needle = searchText(term)
  if (needle === '') return null
  if (needle === searchText(t('history:summary.removedWithUnknown'))) return { kind: 'unknown' }
  const summary = slotPattern(t('history:summary.removedWith', { name: SLOT }))
  if (summary == null) return null
  const name = typedName(summary.lead, summary.tail, term)
  if (name != null) return { kind: 'named', name }
  return startsAWord(summary.lead, needle) || startsAWord(summary.tail, needle)
    ? { kind: 'any' }
    : null
}
