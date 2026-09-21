import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { db } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { indexEntryRefs, readEntryIndex, type EntryIndex, type EntryRef } from '@/lib/entry-refs'
import { entriesStore, generationStore } from '@/lib/stores'

/**
 * `ready` is a neutral "not read yet" marker, not a negative result — while `!ready`,
 * consumers must not treat any id as dangling; nothing has been read yet, or the read
 * failed with no prior data. `failed` distinguishes the latter so a caller can show an
 * error state instead of mistaking an unread branch for an empty one.
 */
export type EntryIndexSnapshot = {
  /** Newest first — the picker's list order. */
  entries: readonly EntryRef[]
  index: EntryIndex
  ready: boolean
  failed: boolean
}

type LoadedWindow = { entries: readonly EntryRef[]; index: EntryIndex }

const EMPTY_ENTRIES: readonly EntryRef[] = []
const EMPTY_INDEX: EntryIndex = new Map()
const EMPTY: EntryIndexSnapshot = {
  entries: EMPTY_ENTRIES,
  index: EMPTY_INDEX,
  ready: false,
  failed: false,
}
const FAILED: EntryIndexSnapshot = { ...EMPTY, failed: true }

/**
 * The branch's entries for `entry #n` labels, chapter buckets and the entry-ref picker.
 * Every story_entries write either settles a run or reversal (settleCount) or moves the
 * tail (tailId) — a user_action insert before the run starts, an ai_reply commit mid-phase,
 * a system-entry write or clear, a rejected-admission reversal — so the two keys together
 * cover every write. Labels resolve by id, so a stale index shows an anchor as falsely
 * live or falsely dangling, never re-pointed to a different entry.
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

  const { data, error } = useQuery({
    queryKey: ['entry-index', branchId, settleCount, tailId],
    enabled: branchId !== '',
    // Local DB read, not a flaky network call — a failure is worth surfacing, not retried.
    retry: false,
    // A key goes dead once superseded by the next settle or tail move; a revisit (a branch
    // switch back, tailId walking backward after a reversal or a system-entry clear) is rare
    // and still correct under the write invariant above — no reason to hold a whole branch's
    // rows for the client's default 5-minute gc.
    gcTime: 30_000,
    queryFn: () => readEntryIndex(branchId, db),
  })

  // data is undefined during a pending refetch and after an error; keep the last
  // successful window, tagged by branch so a fork never shows another branch's index.
  const [lastGood, setLastGood] = useState<{ branchId: string; window: LoadedWindow } | null>(null)
  let good = lastGood
  if (good?.branchId !== branchId) good = null
  // Compare against the wrapped window's rows (not a fresh wrapper) to avoid re-rendering
  // every render.
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
    if (good != null) {
      return { entries: good.window.entries, index: good.window.index, ready: true, failed: false }
    }
    return error != null ? FAILED : EMPTY
  }, [good, error])
}
