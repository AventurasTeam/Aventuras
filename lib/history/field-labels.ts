import type { Delta } from '@/lib/db'
import { t } from '@/lib/i18n'

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

const LABELS: Record<HistoryTable, Labels> = {
  entities: ENTITY,
  lore: LORE,
  threads: THREAD,
  happenings: HAPPENING,
}

function parentPath(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(0, dot)
}

/** A field path's user-facing name: its nearest labelled ancestor, else the raw path. */
export function fieldPathLabel(table: HistoryTable, path: string): string {
  const labels = LABELS[table]
  for (let current = path; current !== ''; current = parentPath(current)) {
    if (Object.hasOwn(labels, current)) return labels[current]()
  }
  return path
}

/** Field paths whose label contains `term`, so searching the summary's wording finds its rows. */
export function pathsMatchingLabel(table: HistoryTable, term: string): string[] {
  const needle = term.trim().toLocaleLowerCase()
  if (needle === '') return []
  return Object.entries(LABELS[table])
    .filter(([, label]) => label().toLocaleLowerCase().includes(needle))
    .map(([path]) => path)
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
