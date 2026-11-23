import type { Delta } from '@/lib/db'
import { logger } from '@/lib/diagnostics'

import type { DiffCacheEntry, DiffWalk, UpdateDelta, WalkResult } from './diff-walk'

/** The cache's hard cap, in entries (architecture.md → Cache shape and lifecycle). */
export const DIFF_CACHE_CAPACITY = 2000

export type DiffOutcome = { kind: 'entry'; entry: DiffCacheEntry } | { kind: 'gone' }

/** A walk that settled after its branch's eviction: nothing was cached or remembered. */
export class DiffEvictedError extends Error {
  constructor(message?: string) {
    super(message)
    this.name = 'DiffEvictedError'
  }
}

export type DiffCache = {
  /** The cached entry, refreshing its recency. Synchronous. */
  peek(branchId: string, deltaId: string): DiffCacheEntry | undefined
  /** The delta's outcome; a tick's calls on one target share one walk. */
  populate(delta: UpdateDelta): Promise<DiffOutcome>
  /** Populates every delta; resolves once all have settled, whatever they settled to. */
  populateBatch(deltas: readonly UpdateDelta[]): Promise<void>
  /** Drops the branch's entries, walks in flight and remembered failures, then tells listeners. */
  evictBranch(branchId: string): void
  /** Hears each evicted branch. Returns its unregister. */
  onEvict(listener: (branchId: string) => void): () => void
}

type Waiting = {
  readonly branchId: string
  readonly delta: UpdateDelta
  readonly key: string
  readonly promise: Promise<DiffOutcome>
  readonly resolve: (outcome: DiffOutcome) => void
  readonly reject: (error: unknown) => void
}

const GONE: DiffOutcome = { kind: 'gone' }

const keyOf = (branchId: string, deltaId: string): string => JSON.stringify([branchId, deltaId])

const targetOf = (delta: Delta): string =>
  JSON.stringify([delta.branchId, delta.targetTable, delta.targetId])

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

function waitingFor(delta: UpdateDelta): Waiting {
  let resolve!: (outcome: DiffOutcome) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<DiffOutcome>((res, rej) => {
    resolve = res
    reject = rej
  })
  return {
    branchId: delta.branchId,
    delta,
    key: keyOf(delta.branchId, delta.id),
    promise,
    resolve,
    reject,
  }
}

function dropBranch(map: Map<string, { readonly branchId: string }>, branchId: string): void {
  for (const [key, value] of map) if (value.branchId === branchId) map.delete(key)
}

/** An LRU of walk results keyed on branch and delta id, evicted by branch. */
export function createDiffCache({
  walk,
  capacity = DIFF_CACHE_CAPACITY,
}: {
  walk: DiffWalk
  capacity?: number
}): DiffCache {
  const entries = new Map<string, { readonly branchId: string; readonly entry: DiffCacheEntry }>()
  const inFlight = new Map<string, Waiting>()
  const failures = new Map<string, { readonly branchId: string; readonly error: unknown }>()
  // Bumped by each eviction, so a walk that started before one can tell it settled after it.
  const generations = new Map<string, number>()
  const listeners = new Set<(branchId: string) => void>()
  let queued: Waiting[] = []

  const generationOf = (branchId: string): number => generations.get(branchId) ?? 0

  function touch(key: string): DiffCacheEntry | undefined {
    const hit = entries.get(key)
    if (hit === undefined) return undefined
    entries.delete(key)
    entries.set(key, hit)
    return hit.entry
  }

  function insert(branchId: string, deltaId: string, entry: DiffCacheEntry): void {
    const key = keyOf(branchId, deltaId)
    entries.delete(key)
    entries.set(key, { branchId, entry })
    for (const oldest of entries.keys()) {
      if (entries.size <= capacity) break
      entries.delete(oldest)
    }
  }

  // An eviction may have replaced a key's waiter already; only this walk's own go.
  function release(items: readonly Waiting[]): void {
    for (const item of items) if (inFlight.get(item.key) === item) inFlight.delete(item.key)
  }

  function rejectEvicted(items: readonly Waiting[], branchId: string): void {
    const error = new DiffEvictedError(`branch ${branchId} was evicted during the walk`)
    for (const item of items) item.reject(error)
  }

  async function run(items: readonly Waiting[]): Promise<void> {
    const { branchId } = items[0]
    const generation = generationOf(branchId)
    const requested = [
      ...new Map(items.map((item): [string, UpdateDelta] => [item.delta.id, item.delta])).values(),
    ]
    let result: WalkResult
    try {
      result = await walk(requested)
    } catch (error) {
      release(items)
      if (generationOf(branchId) !== generation) {
        rejectEvicted(items, branchId)
        return
      }
      for (const delta of requested) {
        failures.set(keyOf(branchId, delta.id), { branchId, error })
        logger.warn('history.diff_walk_failed', {
          branchId,
          deltaId: delta.id,
          reason: messageOf(error),
        })
      }
      for (const item of items) item.reject(error)
      return
    }
    release(items)
    if (generationOf(branchId) !== generation) {
      rejectEvicted(items, branchId)
      return
    }
    for (const [deltaId, entry] of result.entries) insert(branchId, deltaId, entry)
    // From the result, not a peek: a walk can return more entries than the cache holds.
    for (const item of items) {
      const entry = result.entries.get(item.delta.id)
      item.resolve(entry === undefined ? GONE : { kind: 'entry', entry })
    }
  }

  function flush(): void {
    const batch = queued
    queued = []
    const groups = new Map<string, Waiting[]>()
    for (const item of batch) {
      const target = targetOf(item.delta)
      const group = groups.get(target)
      if (group === undefined) groups.set(target, [item])
      else group.push(item)
    }
    for (const group of groups.values()) void run(group)
  }

  const cache: DiffCache = {
    peek: (branchId, deltaId) => touch(keyOf(branchId, deltaId)),

    populate(delta) {
      const key = keyOf(delta.branchId, delta.id)
      const entry = touch(key)
      if (entry !== undefined) return Promise.resolve<DiffOutcome>({ kind: 'entry', entry })
      const failure = failures.get(key)
      if (failure !== undefined) return Promise.reject(failure.error)
      const joined = inFlight.get(key)
      if (joined !== undefined) return joined.promise
      const item = waitingFor(delta)
      inFlight.set(key, item)
      if (queued.length === 0) queueMicrotask(flush)
      queued.push(item)
      return item.promise
    },

    async populateBatch(deltas) {
      await Promise.allSettled(deltas.map((delta) => cache.populate(delta)))
    },

    evictBranch(branchId) {
      dropBranch(entries, branchId)
      dropBranch(inFlight, branchId)
      dropBranch(failures, branchId)
      generations.set(branchId, generationOf(branchId) + 1)
      for (const listener of [...listeners]) {
        try {
          listener(branchId)
        } catch (error) {
          logger.error('history.evict_listener_failed', { branchId, error: messageOf(error) })
        }
      }
    },

    onEvict(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return cache
}
