import type { Delta } from '@/lib/db'
import { t } from '@/lib/i18n'

import { fieldPathLabel, type HistoryTable } from './field-labels'
import { relativeTimeLabel } from './relative-time'

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

/** The field paths an update changed, read off its undo payload's keys; `$` keys are meta. */
export function changedPaths(delta: Pick<Delta, 'op' | 'undoPayload'>): string[] {
  if (delta.op !== 'update' || delta.undoPayload == null) return []
  return Object.entries(delta.undoPayload).flatMap(([key, value]) => {
    if (key.startsWith('$')) return []
    if (!NESTED_COLUMNS.has(key) || !isPlainObject(value)) return [key]
    const inner = nestedPaths(key, value)
    return inner.length > 0 ? inner : [key]
  })
}

export type HumanizeContext = {
  targetTable: HistoryTable
  targetName: string
  entryLabel: (entryId: string) => string | null
  nowMs: number
}

function summary(delta: Delta, table: HistoryTable): string {
  if (delta.op === 'create') return t('history:summary.created')
  if (delta.op === 'delete') return t('history:summary.deleted')
  const labels = [...new Set(changedPaths(delta).map((path) => fieldPathLabel(table, path)))]
  return labels.length === 0
    ? t('history:summary.modifiedUnknown')
    : t('history:summary.modified', { fields: labels.join(', ') })
}

/** Humanizes a delta to a display row, from `undo_payload` keys (C4). */
export function humanizeDelta(delta: Delta, context: HumanizeContext): HistoryRowView {
  const paths = changedPaths(delta)
  return {
    id: delta.id,
    op: delta.op,
    source: delta.source,
    targetTable: delta.targetTable,
    targetDisplayName: context.targetName,
    fieldPath: paths.length === 0 ? null : paths.join(', '),
    summary: summary(delta, context.targetTable),
    entryId: delta.entryId == null ? null : context.entryLabel(delta.entryId),
    createdAtRelative: relativeTimeLabel(delta.createdAt, context.nowMs),
    actionId: delta.actionId,
  }
}
