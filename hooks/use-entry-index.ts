import {
  skipToken,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'

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
  /** A read is running while `ready` shows an earlier window: the last read, or a seed. */
  updating: boolean
  /** Re-reads the current window; the error state's way out, since reads never retry on their own. */
  retry: () => void
}

type LoadedWindow = { entries: readonly EntryRef[]; index: EntryIndex }
/** `seeded`: a seed standing in for the read in flight, not a read this hook made. */
type ShownWindow = { branchId: string; window: LoadedWindow; seeded: boolean }

/** Newest first, as `readEntryIndex` returns them. */
export type EntryIndexRead = (branchId: string) => Promise<readonly EntryRef[]>

const readFromDb: EntryIndexRead = (branchId) => readEntryIndex(branchId, db)

const EntryIndexReadContext = createContext<EntryIndexRead>(readFromDb)

/**
 * Swaps the entry read for stories, which have no app database. The read isn't in the query key,
 * so keep one read per QueryClient; a gorhom Sheet's content doesn't see a provider outside it.
 */
export const EntryIndexReadProvider = EntryIndexReadContext.Provider

type LastReadKey = readonly ['entry-index-last', string]
const lastReadKey = (branchId: string): LastReadKey => ['entry-index-last', branchId]
type LastReadQuery = UseQueryOptions<readonly EntryRef[], Error, readonly EntryRef[], LastReadKey>

const EMPTY_ENTRIES: readonly EntryRef[] = []
const EMPTY_INDEX: EntryIndex = new Map()
const EMPTY = {
  entries: EMPTY_ENTRIES,
  index: EMPTY_INDEX,
  ready: false,
  failed: false,
  updating: false,
}
const FAILED = { ...EMPTY, failed: true }

/**
 * Branch entries for `entry #n` labels, chapter buckets and the entry-ref picker.
 * settleCount + tailId together cover every story_entries write: a new write path must settle
 * a run/reversal or move the tail, or the index goes stale. Stale only shows an anchor as
 * falsely live/dangling — never re-pointed to a different entry.
 * `enabled: false` skips the read and reads not ready (still `failed` if the last read errored).
 * `seedFromLastRead`: with no window of its own, show the branch's last read by a seeding hook
 * while this one reads, rather than reading not ready.
 */
export function useEntryIndex(
  branchId: string,
  options?: { enabled?: boolean; seedFromLastRead?: boolean },
): EntryIndexSnapshot {
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

  const read = useContext(EntryIndexReadContext)
  const client = useQueryClient()
  const disabled = options?.enabled === false
  const seeds = options?.seedFromLastRead === true
  // The branch's last read, for a seeding hook to start from. Never collected, unlike the per-key
  // reads below, so it outlasts their 30 s gc.
  const lastReadQueries: LastReadQuery[] = seeds
    ? [{ queryKey: lastReadKey(branchId), queryFn: skipToken, gcTime: Infinity }]
    : []
  const seed = useQueries({ queries: lastReadQueries }).at(0)?.data
  const { data, error, refetch, isFetching } = useQuery({
    queryKey: ['entry-index', branchId, settleCount, tailId],
    enabled: branchId !== '' && !disabled,
    // Local DB read, not a flaky network call — a failure is worth surfacing, not retried.
    retry: false,
    // A revisited key (branch switch back, tailId walking backward) is rare but still
    // correct — no reason to hold a whole branch's rows for the default 5-minute gc.
    gcTime: 30_000,
    queryFn: () => read(branchId),
  })

  // data is undefined during a pending refetch and after an error; keep the last
  // successful window, tagged by branch so a fork never shows another branch's index.
  const [lastGood, setLastGood] = useState<ShownWindow | null>(null)
  // A disabled hook drops the window (the query keeps its cached data), so it reads not-ready.
  let good = lastGood
  if (disabled || good?.branchId !== branchId) good = null
  // Compare against the wrapped window's rows (not a fresh wrapper) to avoid re-rendering.
  if (!disabled && data != null && data !== good?.window.entries) {
    good = { branchId, window: { entries: data, index: indexEntryRefs(data) }, seeded: false }
  }
  if (good == null && !disabled && seed != null) {
    good = { branchId, window: { entries: seed, index: indexEntryRefs(seed) }, seeded: true }
  }
  if (good !== lastGood) setLastGood(good)

  useEffect(() => {
    if (seeds && data != null) client.setQueryData(lastReadKey(branchId), data)
  }, [seeds, data, client, branchId])

  useEffect(() => {
    if (error == null) return
    logger.warn('app.entry_index_read_failed', {
      branchId,
      error: error instanceof Error ? error.message : String(error),
    })
  }, [error, branchId])

  return useMemo(() => {
    const retry = () => void refetch()
    // A seed only stands in while its read runs; a failed read shows as one, Retry included.
    if (good != null && !(good.seeded && error != null)) {
      const { entries, index } = good.window
      return { entries, index, ready: true, failed: false, updating: isFetching, retry }
    }
    return { ...(error != null ? FAILED : EMPTY), retry }
  }, [good, error, isFetching, refetch])
}
