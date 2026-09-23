import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { db } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { indexEntryRefs, readEntryIndex, type EntryIndex, type EntryRef } from '@/lib/entry-refs'
import { entriesStore, generationStore } from '@/lib/stores'

/**
 * `ready` is a neutral "not read yet" marker — while `!ready`, no id counts as dangling.
 * `failed` distinguishes "read failed" from "not read yet" for an error-state caller.
 */
export type EntryIndexSnapshot = {
  /** Newest first — the picker's list order. */
  entries: readonly EntryRef[]
  index: EntryIndex
  ready: boolean
  failed: boolean
  /** Re-reads the current window; the error state's way out, since reads never retry on their own. */
  retry: () => void
}

type LoadedWindow = { entries: readonly EntryRef[]; index: EntryIndex }

const EMPTY_ENTRIES: readonly EntryRef[] = []
const EMPTY_INDEX: EntryIndex = new Map()
const EMPTY = { entries: EMPTY_ENTRIES, index: EMPTY_INDEX, ready: false, failed: false }
const FAILED = { ...EMPTY, failed: true }

/**
 * Branch entries for `entry #n` labels, chapter buckets and the entry-ref picker.
 * settleCount + tailId together cover every story_entries write: a new write path must settle
 * a run/reversal or move the tail, or the index goes stale. Stale only shows an anchor as
 * falsely live/dangling — never re-pointed to a different entry.
 */
export function useEntryIndex(branchId: string): EntryIndexSnapshot {
  const settleCount = generationStore.useGeneration((s) => s.settleCount)
  const tailId = entriesStore.useEntries((m) => {
    let last: string | null = null
    let position = -1
    for (const e of m.values()) {
      if (e.branchId === branchId && e.position > position) {
        position = e.position
        last = e.id
      }
    }
    return last
  })

  const { data, error, refetch } = useQuery({
    queryKey: ['entry-index', branchId, settleCount, tailId],
    enabled: branchId !== '',
    // Local DB read, not a flaky network call — a failure is worth surfacing, not retried.
    retry: false,
    // A revisited key (branch switch back, tailId walking backward) is rare but still
    // correct — no reason to hold a whole branch's rows for the default 5-minute gc.
    gcTime: 30_000,
    queryFn: () => readEntryIndex(branchId, db),
  })

  // data is undefined during a pending refetch and after an error; keep the last
  // successful window, tagged by branch so a fork never shows another branch's index.
  const [lastGood, setLastGood] = useState<{ branchId: string; window: LoadedWindow } | null>(null)
  let good = lastGood
  if (good?.branchId !== branchId) good = null
  // Compare against the wrapped window's rows (not a fresh wrapper) to avoid re-rendering.
  if (data != null && data !== good?.window.entries) {
    good = { branchId, window: { entries: data, index: indexEntryRefs(data) } }
  }
  if (good !== lastGood) setLastGood(good)

  useEffect(() => {
    if (error == null) return
    logger.warn('app.entry_index_read_failed', {
      branchId,
      error: error instanceof Error ? error.message : String(error),
    })
  }, [error, branchId])

  return useMemo(() => {
    const retry = () => void refetch()
    if (good != null) {
      const { entries, index } = good.window
      return { entries, index, ready: true, failed: false, retry }
    }
    return { ...(error != null ? FAILED : EMPTY), retry }
  }, [good, error, refetch])
}
