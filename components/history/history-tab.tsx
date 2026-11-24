import { useEffect, useMemo, useReducer, useRef, useState } from 'react'

import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useEntryIndex } from '@/hooks/use-entry-index'
import type { Delta } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { formatEntryRef } from '@/lib/entry-refs'
import {
  diffProse,
  entryIdsOf,
  humanizeDelta,
  refIdsOf,
  type DiffCacheEntry,
  type DiffOutcome,
  type HistoryOp,
  type HistoryRow,
  type HistorySort,
  type HistoryTable,
  type ProseContext,
  type ProseTarget,
} from '@/lib/history'
import { t } from '@/lib/i18n'
import { entitiesStore, generationStore, happeningsStore } from '@/lib/stores'

import { HistoryTabView } from './history-tab-view'
import { useDiffOutcomes } from './use-diff-outcomes'
import { useHistoryChunks } from './use-history-chunks'
import { historyTargetName, useHistoryTarget } from './use-history-target'
import { useLinkVersion } from './use-link-version'

const SEARCH_DEBOUNCE_MS = 250

/** How long refresh triggers must hold still before the tab refetches once for all of them. */
export const REFRESH_COALESCE_MS = 150

export type HistoryTabProps = {
  branchId: string
  targetTable: HistoryTable
  targetId: string
  onOpenEntry: (entryId: string) => void
}

/** C4: one row's delta log; keyed by target so switching rows remounts and resets it. */
export function HistoryTab(props: HistoryTabProps) {
  return <HistoryTabForTarget key={`${props.targetTable}:${props.targetId}`} {...props} />
}

function otherEndIds(rows: readonly HistoryRow[]): string[] {
  return [...new Set(rows.flatMap((row) => (row.via.kind === 'own' ? [] : [row.via.otherId])))]
}

// Working-set names for the given ids (other ends, prose refs). Selectors return a string, so a
// patch to any other row leaves the tab alone.
function useStoreNames(branchId: string, ids: readonly string[]): ReadonlyMap<string, string> {
  const entityNames = entitiesStore.useEntities(branchId, (m) =>
    JSON.stringify(ids.map((id) => m.get(id)?.name ?? null)),
  )
  const happeningTitles = happeningsStore.useHappenings(branchId, (m) =>
    JSON.stringify(ids.map((id) => m.get(id)?.title ?? null)),
  )
  return useMemo(() => {
    const entity = JSON.parse(entityNames) as (string | null)[]
    const happening = JSON.parse(happeningTitles) as (string | null)[]
    const names = new Map<string, string>()
    ids.forEach((id, i) => {
      const name = entity[i] ?? happening[i]
      if (name != null) names.set(id, name)
    })
    return names
  }, [ids, entityNames, happeningTitles])
}

// A watched other end that leaves the working set must re-read its name from its delete payload,
// and under a search a rename changes which rows match server-side; either calls `onChange`.
function useOtherEndChanges(
  names: ReadonlyMap<string, string>,
  ids: readonly string[],
  searching: boolean,
  onChange: () => void,
): void {
  const seen = useRef(names)
  useEffect(() => {
    const before = seen.current
    seen.current = names
    const changed = ids.some((id) => {
      const was = before.get(id)
      if (was == null) return false
      const now = names.get(id)
      return now == null || (searching && now !== was)
    })
    if (changed) onChange()
  }, [names, ids, searching, onChange])
}

// The labels an update row's prose reads: its own table's, or the link's by the tab's side.
function proseTarget(row: HistoryRow, targetTable: HistoryTable): ProseTarget | null {
  switch (row.via.kind) {
    case 'own':
      return { table: targetTable, side: null }
    case 'link':
      if (row.via.table === 'character_relationships')
        return { table: row.via.table, side: row.via.side }
      return { table: row.via.table, side: null }
    case 'removed':
      return null
  }
}

function refIdsOfRows(
  rows: readonly HistoryRow[],
  outcomes: ReadonlyMap<string, DiffOutcome>,
  targetTable: HistoryTable,
): string[] {
  const ids = new Set<string>()
  for (const row of rows) {
    const outcome = outcomes.get(row.delta.id)
    const target = proseTarget(row, targetTable)
    if (outcome?.kind !== 'entry' || target == null) continue
    for (const id of refIdsOf(target.table, outcome.entry)) ids.add(id)
  }
  return [...ids]
}

/** An update row whose walked entry holds a value of the wrong type at `path`. */
type MistypedRow = { entry: DiffCacheEntry; delta: Delta; path: string }

type ProseLookups = Pick<ProseContext, 'liveName' | 'entryLabel'> & {
  /** The entry index hasn't read, re-reads, or failed its last read. */
  entryIndexStale: boolean
  onMistyped: (row: MistypedRow) => void
}

// world.md → Change prose: null keeps the field-name summary (pending, failed, gone, no wording).
function changeProse(
  row: HistoryRow,
  outcome: DiffOutcome | undefined,
  targetTable: HistoryTable,
  { liveName, entryLabel, entryIndexStale, onMistyped }: ProseLookups,
): string | null {
  const target = proseTarget(row, targetTable)
  if (outcome?.kind !== 'entry' || target == null) return null
  const { entry } = outcome
  // An entry a stale index lacks may be new, not gone: "Unknown entry" waits for a fresh read.
  const unheld = entryIdsOf(target.table, entry).some((id) => entryLabel(id) === null)
  if (unheld && entryIndexStale) return null
  return diffProse(entry, {
    ...target,
    liveName,
    entryLabel,
    onMistyped: (path) => onMistyped({ entry, delta: row.delta, path }),
  })
}

// Once per walk result, as a failed walk warns: rows re-render and remount on the cache's entry.
const warnedMistyped = new WeakSet<DiffCacheEntry>()

function useMistypedWarnings(found: readonly MistypedRow[]): void {
  useEffect(() => {
    for (const { entry, delta, path } of found) {
      if (warnedMistyped.has(entry)) continue
      warnedMistyped.add(entry)
      logger.warn('history.diff_prose_mistyped', {
        branchId: delta.branchId,
        deltaId: delta.id,
        path,
      })
    }
  }, [found])
}

function HistoryTabForTarget({ branchId, targetTable, targetId, onOpenEntry }: HistoryTabProps) {
  const [searchInput, setSearchInput] = useState('')
  const search = useDebouncedValue(searchInput.trim(), SEARCH_DEBOUNCE_MS)
  const [op, setOp] = useState<HistoryOp | null>(null)
  const [sort, setSort] = useState<HistorySort>('newest')
  const row = useHistoryTarget(branchId, targetTable, targetId)
  const settleCount = generationStore.useGeneration((s) => s.settleCount)
  const links = useLinkVersion(targetTable, targetId, branchId)
  const [otherEnds, otherEndChanged] = useReducer((n: number) => n + 1, 0)
  // Fresh identity on world.md → History tab's Refresh triggers; a retrieval bump isn't one.
  const version = useMemo(
    () => ({ row, settleCount, links, otherEnds }),
    [row, settleCount, links, otherEnds],
  )
  // A classifier pass commits each write on its own; the burst gets one refetch, after it.
  const settledVersion = useDebouncedValue(version, REFRESH_COALESCE_MS)
  const chunks = useHistoryChunks(
    { branchId, targetTable, targetId, op: op ?? undefined, search, sort },
    settledVersion,
  )
  const entryIndex = useEntryIndex(branchId)
  // Under a search every link end is watched: a rename can make an unshown one match.
  const otherIds = useMemo(
    () => (search === '' ? otherEndIds(chunks.rows) : Object.keys(chunks.names)),
    [chunks.rows, chunks.names, search],
  )
  const storeNames = useStoreNames(branchId, otherIds)
  useOtherEndChanges(storeNames, otherIds, search !== '', otherEndChanged)
  const outcomes = useDiffOutcomes(chunks.rows)
  const refIds = useMemo(
    () => refIdsOfRows(chunks.rows, outcomes, targetTable),
    [chunks.rows, outcomes, targetTable],
  )
  // Read as the other ends are, so a ref the store holds on another branch reads (deleted).
  const refNames = useStoreNames(branchId, refIds)
  const name = historyTargetName(row) ?? t('history:unknownTarget')
  const { rows, mistyped } = useMemo(() => {
    const nowMs = Date.now()
    const entryLabel = (entryId: string) => {
      const ref = entryIndex.index.get(entryId)
      return ref == null ? null : formatEntryRef(ref.position)
    }
    // The working set first, so a renamed other end reads its new name.
    const otherName = (id: string) => storeNames.get(id) ?? chunks.names[id] ?? null
    const found: MistypedRow[] = []
    const lookups: ProseLookups = {
      liveName: (id) => refNames.get(id) ?? null,
      entryLabel,
      entryIndexStale: entryIndex.stale,
      onMistyped: (row) => found.push(row),
    }
    const shown = chunks.rows.map((historyRow) => {
      const view = humanizeDelta(historyRow, {
        targetTable,
        targetName: name,
        otherName,
        entryLabel,
        nowMs,
      })
      const prose = changeProse(historyRow, outcomes.get(historyRow.delta.id), targetTable, lookups)
      return prose == null ? view : { ...view, summary: prose }
    })
    return { rows: shown, mistyped: found }
  }, [
    chunks.rows,
    chunks.names,
    entryIndex.index,
    entryIndex.stale,
    targetTable,
    name,
    storeNames,
    refNames,
    outcomes,
  ])
  useMistypedWarnings(mistyped)

  return (
    <HistoryTabView
      rows={rows}
      status={chunks.status}
      hasMore={chunks.hasMore}
      filtered={search !== '' || op != null}
      search={searchInput}
      onSearchChange={setSearchInput}
      op={op}
      onOpChange={setOp}
      sort={sort}
      onSortChange={setSort}
      onLoadMore={chunks.loadMore}
      onRetry={chunks.retry}
      onOpenEntry={onOpenEntry}
    />
  )
}
