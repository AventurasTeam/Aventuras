import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import { ENTRIES_WINDOW_SIZE } from '@/lib/actions'
import type { DbCtx, StoryEntry } from '@/lib/db'
import { entriesStore } from '@/lib/stores'

import {
  classifyJump,
  deriveSlice,
  extendDown,
  extendUp,
  markWindowTop,
  placeJump,
  reloadSlice,
  resetToTail,
  trimSlice,
  type JumpClass,
  type SliceRequest,
  type SliceState,
  type TrimRequest,
} from './reader-slice'
import { useLoadOlderEntries } from './use-load-older-entries'

type SliceStore = {
  get: () => SliceState | null
  /** Stores `next` unless the state it was derived from has since been replaced. */
  replace: (expected: SliceState | null, next: SliceState) => void
  subscribe: (listener: () => void) => () => void
}

// Outside React state: a jump must name the key of the slice it moves to in the same tick.
function createSliceStore(): SliceStore {
  let state: SliceState | null = null
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    replace: (expected, next) => {
      if (state !== expected) return
      state = next
      for (const listener of [...listeners]) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

// The store replaces its map on every write and reads one shared empty map for a branch it doesn't
// hold, so the map's identity alone keys the sorted window.
let sortedWindow: { rows: ReadonlyMap<string, StoryEntry>; window: StoryEntry[] } = {
  rows: new Map(),
  window: [],
}

/** The store's window for the branch now, sorted: handlers run between renders. */
function readWindow(branchId: string): StoryEntry[] {
  const rows = entriesStore.getEntries(branchId)
  if (sortedWindow.rows !== rows) {
    sortedWindow = { rows, window: [...rows.values()].sort((a, b) => a.position - b.position) }
  }
  return sortedWindow.window
}

export type ReaderSlice = {
  rows: StoryEntry[]
  hasOlder: boolean
  hasNewer: boolean
  sliceKey: number
  /** The document's boundary requests; each settles, never rejects. */
  requestNearTop: (request: SliceRequest) => Promise<void>
  requestNearBottom: (request: SliceRequest) => Promise<void>
  requestTrim: (request: TrimRequest) => Promise<void>
  classifyJump: (entryId: string) => JumpClass
  /** Moves the slice to a jump's target when it doesn't land at once; returns the key to name. */
  placeLanding: (entryId: string) => number
  /** Swaps a slice short of the tail to the tail's last rows; returns the key to name. */
  toTail: () => number
  /** A read proved the branch top is in the window. */
  topLoaded: () => void
  /** The window was reloaded with its recent page. */
  reloaded: (windowHasOlder: boolean) => void
  /** The document reloaded: it lands at the bottom of a slice at the tail. */
  resetToTail: () => void
}

/**
 * The host half of the sliding reader window (reader-composer.md → Loaded-set model): the bounds
 * of the slice the document renders, over `entries`, the store's sorted window for `branchId`.
 */
export function useReaderSlice(
  branchId: string,
  entries: StoryEntry[],
  db: DbCtx['db'],
): ReaderSlice {
  const [store] = useState(createSliceStore)
  const state = useSyncExternalStore(store.subscribe, store.get)
  const view = useMemo(
    () => deriveSlice(state, branchId, entries, ENTRIES_WINDOW_SIZE),
    [state, branchId, entries],
  )
  useLayoutEffect(() => {
    if (view.next != null) store.replace(state, view.next)
  }, [store, state, view.next])

  // The document's view of the state, with any open or fallback the layout effect hasn't stored.
  const current = useCallback((): { from: SliceState; window: StoryEntry[] } | null => {
    const stored = store.get()
    const window = readWindow(branchId)
    const derived = deriveSlice(stored, branchId, window, ENTRIES_WINDOW_SIZE)
    if (derived.next != null) store.replace(stored, derived.next)
    const from = derived.next ?? (stored?.branchId === branchId ? stored : null)
    return from == null ? null : { from, window }
  }, [store, branchId])

  const apply = useCallback(
    (from: SliceState, next: SliceState | null) => {
      if (next != null) store.replace(from, next)
    },
    [store],
  )

  // The request a load above the window answers: applied in the insert's tick, so the rows and
  // the slice that shows them reach the document in one emission.
  const pendingUpRef = useRef<SliceRequest | null>(null)
  const onBoundary = useCallback(
    (windowHasOlder: boolean) => {
      const read = current()
      if (read == null) return
      const { from, window } = read
      const request = pendingUpRef.current
      pendingUpRef.current = null
      apply(
        from,
        (request != null ? extendUp(from, window, request, windowHasOlder) : null) ??
          markWindowTop(from, windowHasOlder),
      )
    },
    [apply, current],
  )
  const loadOlderEntries = useLoadOlderEntries(branchId, db, onBoundary)

  const requestNearTop = useCallback(
    async (request: SliceRequest) => {
      const read = current()
      if (read == null || request.sliceKey !== read.from.key) return
      const { from, window } = read
      // Above the window's oldest row, the next page is read into the window first.
      if (from.windowHasOlder && window.length > 0 && window[0].position >= from.top) {
        pendingUpRef.current = request
        await loadOlderEntries()
        return
      }
      apply(from, extendUp(from, window, request))
    },
    [apply, current, loadOlderEntries],
  )
  const requestNearBottom = useCallback(
    async (request: SliceRequest) => {
      const read = current()
      if (read != null) apply(read.from, extendDown(read.from, read.window, request))
    },
    [apply, current],
  )
  const requestTrim = useCallback(
    async (request: TrimRequest) => {
      const read = current()
      if (read != null) apply(read.from, trimSlice(read.from, read.window, request))
    },
    [apply, current],
  )

  const classify = useCallback(
    (entryId: string): JumpClass => {
      const read = current()
      return read == null ? 'read' : classifyJump(read.from, read.window, entryId)
    },
    [current],
  )
  const placeLanding = useCallback(
    (entryId: string) => {
      const read = current()
      if (read == null) return 0
      const next = placeJump(read.from, read.window, entryId)
      apply(read.from, next)
      return (next ?? read.from).key
    },
    [apply, current],
  )
  const toTail = useCallback(() => {
    const read = current()
    if (read == null) return 0
    // At the tail Jump to bottom scrolls; only a slice short of it swaps.
    if (read.from.bottom == null) return read.from.key
    const next = resetToTail(read.from, read.window)
    apply(read.from, next)
    return (next ?? read.from).key
  }, [apply, current])
  const topLoaded = useCallback(() => {
    const read = current()
    if (read != null) apply(read.from, markWindowTop(read.from, false))
  }, [apply, current])
  const reloaded = useCallback(
    (windowHasOlder: boolean) => {
      const read = current()
      if (read != null) apply(read.from, reloadSlice(read.from, read.window, windowHasOlder))
    },
    [apply, current],
  )
  const resetSliceToTail = useCallback(() => {
    const read = current()
    if (read != null) apply(read.from, resetToTail(read.from, read.window))
  }, [apply, current])

  return {
    rows: view.rows,
    hasOlder: view.hasOlder,
    hasNewer: view.hasNewer,
    sliceKey: view.sliceKey,
    requestNearTop,
    requestNearBottom,
    requestTrim,
    classifyJump: classify,
    placeLanding,
    toTail,
    topLoaded,
    reloaded,
    resetToTail: resetSliceToTail,
  }
}
