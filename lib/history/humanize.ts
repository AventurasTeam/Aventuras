import { isPayloadMetaKey } from '@/lib/actions'
import type { Delta } from '@/lib/db'
import { relativeTimeLabel, t } from '@/lib/i18n'

import {
  fieldPathLabel,
  linkTableLabel,
  SUMMARY_FIELD_SEPARATOR,
  type HistoryTable,
} from './field-labels'
import type { HistoryLinkTable, HistoryRow, HistoryVia, LinkSide } from './link-rows'

/** DeltaLogRow's `delta` prop, pre-formatted (patterns/delta-log-row.md → Compound API). */
export type HistoryRowView = {
  id: string
  op: Delta['op']
  source: Delta['source']
  targetTable: string
  targetDisplayName: string
  fieldPath: string | null
  summary: string
  /** The pre-formatted `entry #n`, or null. */
  entryId: string | null
  createdAtRelative: string
  actionId: string
}

// Columns whose undo payload is a nested partial (data-model.md → op=update encoding rule).
const NESTED_COLUMNS = new Set(['state', 'metadata'])
const DESCEND = new Set(['state.visual'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nestedPaths(prefix: string, value: Record<string, unknown>): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = `${prefix}.${key}`
    return DESCEND.has(path) && isPlainObject(child) ? nestedPaths(path, child) : [path]
  })
}

/** The field paths an update changed, read off its undo payload's keys, skipping meta keys. */
export function changedPaths(delta: Pick<Delta, 'op' | 'undoPayload'>): string[] {
  if (delta.op !== 'update' || delta.undoPayload == null) return []
  return Object.entries(delta.undoPayload).flatMap(([key, value]) => {
    if (isPayloadMetaKey(key)) return []
    if (!NESTED_COLUMNS.has(key) || !isPlainObject(value)) return [key]
    const inner = nestedPaths(key, value)
    return inner.length > 0 ? inner : [key]
  })
}

export type HumanizeContext = {
  targetTable: HistoryTable
  targetName: string
  /** The other end's display name, or null when it can't be resolved. */
  otherName: (id: string) => string | null
  entryLabel: (entryId: string) => string | null
  nowMs: number
}

function opSummary(delta: Delta, table: HistoryTable | HistoryLinkTable, side?: LinkSide): string {
  if (delta.op === 'create') return t('history:summary.created')
  if (delta.op === 'delete') return t('history:summary.deleted')
  const labels = [...new Set(changedPaths(delta).map((path) => fieldPathLabel(table, path, side)))]
  return labels.length === 0
    ? t('history:summary.modifiedUnknown')
    : t('history:summary.modified', { fields: labels.join(SUMMARY_FIELD_SEPARATOR) })
}

function otherEndName(id: string, context: HumanizeContext): string {
  return context.otherName(id) ?? t('history:unknownTarget')
}

// world.md → History tab: a link row names the link and its other end; the tab's row is implied.
function targetDisplayName(via: HistoryVia, context: HumanizeContext): string {
  switch (via.kind) {
    case 'own':
      return context.targetName
    case 'link':
      return t('history:link.target', {
        label: linkTableLabel(via.table),
        name: otherEndName(via.otherId, context),
      })
    case 'removed':
      return via.tables.length === 1 ? linkTableLabel(via.tables[0]) : t('history:linkLabel.links')
  }
}

function summary({ delta, via }: HistoryRow, context: HumanizeContext): string {
  switch (via.kind) {
    case 'own':
      return opSummary(delta, context.targetTable)
    case 'link':
      return opSummary(delta, via.table, via.side)
    case 'removed':
      return t('history:summary.removedWith', { name: otherEndName(via.otherId, context) })
  }
}

/** Humanizes a union row to a display row, from `undo_payload` keys (C4). */
export function humanizeDelta(row: HistoryRow, context: HumanizeContext): HistoryRowView {
  const { delta } = row
  const paths = changedPaths(delta)
  return {
    id: delta.id,
    op: delta.op,
    source: delta.source,
    targetTable: delta.targetTable,
    targetDisplayName: targetDisplayName(row.via, context),
    fieldPath: paths.length === 0 ? null : paths.join(', '),
    summary: summary(row, context),
    entryId: delta.entryId == null ? null : context.entryLabel(delta.entryId),
    createdAtRelative: relativeTimeLabel(delta.createdAt, context.nowMs),
    actionId: delta.actionId,
  }
}
