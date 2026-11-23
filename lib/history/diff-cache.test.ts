import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Delta } from '@/lib/db'
import { logger } from '@/lib/diagnostics'

import { createDiffCache, DIFF_CACHE_CAPACITY, DiffEvictedError } from './diff-cache'
import { DiffWalkError, type DiffCacheEntry, type DiffWalk, type WalkResult } from './diff-walk'

afterEach(() => {
  vi.restoreAllMocks()
})

const delta = (id: string, over: Partial<Delta> = {}): Delta => ({
  id,
  branchId: 'br_b',
  entryId: null,
  actionId: `act_${id}`,
  logPosition: 1,
  source: 'user_edit',
  targetTable: 'lore',
  targetId: 'lore_ford',
  op: 'update',
  undoPayload: { title: 'The ford' },
  encodingVersion: 1,
  createdAt: 1,
  ...over,
})

// Names its delta and branch, so an entry served under the wrong key shows.
const entryFor = (d: Delta): DiffCacheEntry => ({
  old: { title: 'The ford' },
  new: { title: `${d.id} on ${d.branchId}` },
  names: {},
})

const answering = () =>
  vi.fn<DiffWalk>(async (requested) => ({
    entries: new Map(requested.map((d): [string, DiffCacheEntry] => [d.id, entryFor(d)])),
    gone: new Set<string>(),
  }))

// A macrotask: the cache's microtask flush, and the walks it starts, have run.
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const FRESH: DiffCacheEntry = {
  old: { title: 'The ford' },
  new: { title: 'The Harrow ford' },
  names: {},
}
const STALE: DiffCacheEntry = {
  old: { title: 'The ford' },
  new: { title: 'half reversed' },
  names: {},
}

const resultOf = (entry: DiffCacheEntry): WalkResult => ({
  entries: new Map([['dl_1', entry]]),
  gone: new Set<string>(),
})

describe('createDiffCache', () => {
  it('misses, populates through the walk, then hits on peek and populate', async () => {
    const walk = answering()
    const cache = createDiffCache({ walk })
    const entry = { old: { title: 'The ford' }, new: { title: 'dl_1 on br_b' }, names: {} }

    expect(cache.peek('br_b', 'dl_1')).toBeUndefined()
    await expect(cache.populate(delta('dl_1'))).resolves.toEqual({ kind: 'entry', entry })
    expect(cache.peek('br_b', 'dl_1')).toEqual(entry)
    await expect(cache.populate(delta('dl_1'))).resolves.toEqual({ kind: 'entry', entry })
    expect(walk).toHaveBeenCalledTimes(1)
  })

  it('keeps one delta id on two branches as two entries', async () => {
    const walk = answering()
    const cache = createDiffCache({ walk })

    await Promise.all([
      cache.populate(delta('dl_1', { branchId: 'br_b' })),
      cache.populate(delta('dl_1', { branchId: 'br_c' })),
    ])

    expect(walk).toHaveBeenCalledTimes(2)
    expect(cache.peek('br_b', 'dl_1')?.new).toEqual({ title: 'dl_1 on br_b' })
    expect(cache.peek('br_c', 'dl_1')?.new).toEqual({ title: 'dl_1 on br_c' })
  })

  describe('LRU', () => {
    it('holds 2000 entries; the 2001st evicts the least recent, and a peek hit refreshes recency', async () => {
      expect(DIFF_CACHE_CAPACITY).toBe(2000)
      const walk = answering()
      const cache = createDiffCache({ walk })
      await cache.populateBatch(
        Array.from({ length: 2000 }, (_, i) => delta(`dl_${i}`, { logPosition: i })),
      )
      expect(walk).toHaveBeenCalledTimes(1)

      expect(cache.peek('br_b', 'dl_0')).toBeDefined()
      await cache.populate(delta('dl_2000', { targetId: 'lore_tide' }))

      expect(cache.peek('br_b', 'dl_1')).toBeUndefined()
      expect(cache.peek('br_b', 'dl_0')).toBeDefined()
      expect(cache.peek('br_b', 'dl_1999')).toBeDefined()
      expect(cache.peek('br_b', 'dl_2000')).toBeDefined()
    })

    it('refreshes recency on a populate hit', async () => {
      const walk = answering()
      const cache = createDiffCache({ walk, capacity: 2 })
      await cache.populate(delta('dl_a', { targetId: 'lore_a' }))
      await cache.populate(delta('dl_b', { targetId: 'lore_b' }))
      await cache.populate(delta('dl_a', { targetId: 'lore_a' }))
      await cache.populate(delta('dl_c', { targetId: 'lore_c' }))

      expect(walk).toHaveBeenCalledTimes(3)
      expect(cache.peek('br_b', 'dl_b')).toBeUndefined()
      expect(cache.peek('br_b', 'dl_a')).toBeDefined()
      expect(cache.peek('br_b', 'dl_c')).toBeDefined()
    })

    it('resolves the requested delta from a walk that returns more entries than the cache holds', async () => {
      const walk = vi.fn<DiffWalk>(async () => ({
        entries: new Map(
          Array.from({ length: 8 }, (_, i): [string, DiffCacheEntry] => [
            `dl_${i}`,
            { old: { title: `t${i}` }, new: { title: `t${i + 1}` }, names: {} },
          ]),
        ),
        gone: new Set<string>(),
      }))
      const cache = createDiffCache({ walk, capacity: 3 })

      await expect(cache.populate(delta('dl_0'))).resolves.toEqual({
        kind: 'entry',
        entry: { old: { title: 't0' }, new: { title: 't1' }, names: {} },
      })
      expect(cache.peek('br_b', 'dl_0')).toBeUndefined()
      expect(cache.peek('br_b', 'dl_7')).toBeDefined()
    })
  })

  describe('coalescing and batching', () => {
    it('runs one walk for concurrent populates of one key, and joins one while it runs', async () => {
      const gate = deferred<WalkResult>()
      const walk = vi.fn<DiffWalk>(() => gate.promise)
      const cache = createDiffCache({ walk })
      const first = cache.populate(delta('dl_1'))
      const second = cache.populate(delta('dl_1'))
      await settle()
      const third = cache.populate(delta('dl_1'))
      await settle()

      expect(walk).toHaveBeenCalledTimes(1)
      expect(walk.mock.calls[0][0].map((d) => d.id)).toEqual(['dl_1'])
      gate.resolve(resultOf(FRESH))
      for (const waiting of [first, second, third])
        await expect(waiting).resolves.toEqual({ kind: 'entry', entry: FRESH })
    })

    it('runs one walk per target for N deltas over M targets, batched or populated in one tick', async () => {
      const rows = [
        delta('dl_1', { targetId: 'lore_a' }),
        delta('dl_2', { targetId: 'lore_b' }),
        delta('dl_3', { targetId: 'lore_a' }),
        delta('dl_4', { targetId: 'lore_c' }),
        delta('dl_5', { targetId: 'lore_b' }),
        delta('dl_6', { targetId: 'lore_a' }),
      ]
      const batched = answering()
      const batchCache = createDiffCache({ walk: batched })
      await expect(batchCache.populateBatch(rows)).resolves.toBeUndefined()
      expect(batched.mock.calls.map(([requested]) => requested.map((d) => d.id))).toEqual([
        ['dl_1', 'dl_3', 'dl_6'],
        ['dl_2', 'dl_5'],
        ['dl_4'],
      ])
      for (const id of ['dl_1', 'dl_2', 'dl_3', 'dl_4', 'dl_5', 'dl_6'])
        expect(batchCache.peek('br_b', id)).toBeDefined()

      const ticked = answering()
      const tickCache = createDiffCache({ walk: ticked })
      await Promise.all(rows.map((row) => tickCache.populate(row)))
      expect(ticked).toHaveBeenCalledTimes(3)
    })
  })

  describe('eviction', () => {
    it("drops the evicted branch's entries, keeps another's, and tells listeners", async () => {
      const cache = createDiffCache({ walk: answering() })
      await cache.populate(delta('dl_1', { branchId: 'br_b' }))
      await cache.populate(delta('dl_2', { branchId: 'br_c' }))
      const heard: string[] = []
      cache.onEvict((branchId) => heard.push(branchId))

      cache.evictBranch('br_b')

      expect(cache.peek('br_b', 'dl_1')).toBeUndefined()
      expect(cache.peek('br_c', 'dl_2')?.new).toEqual({ title: 'dl_2 on br_c' })
      expect(heard).toEqual(['br_b'])
    })

    it('walks a populate queued before an eviction after it, with one queued after, and settles both', async () => {
      const walk = answering()
      const cache = createDiffCache({ walk })
      const entry = { old: { title: 'The ford' }, new: { title: 'dl_1 on br_b' }, names: {} }

      const queuedBefore = cache.populate(delta('dl_1'))
      cache.evictBranch('br_b')
      const queuedAfter = cache.populate(delta('dl_1'))

      await expect(queuedBefore).resolves.toEqual({ kind: 'entry', entry })
      await expect(queuedAfter).resolves.toEqual({ kind: 'entry', entry })
      expect(walk).toHaveBeenCalledTimes(1)
      expect(walk.mock.calls[0][0].map((d) => d.id)).toEqual(['dl_1'])
    })

    it('drops a walk its branch was evicted under, and walks again for a populate after the eviction', async () => {
      const gate = deferred<WalkResult>()
      const walk = vi.fn<DiffWalk>(async () => resultOf(FRESH)).mockReturnValueOnce(gate.promise)
      const cache = createDiffCache({ walk })
      const stale = cache.populate(delta('dl_1'))
      await settle()

      cache.evictBranch('br_b')
      const fresh = cache.populate(delta('dl_1'))
      await expect(fresh).resolves.toEqual({ kind: 'entry', entry: FRESH })
      expect(walk).toHaveBeenCalledTimes(2)
      gate.resolve(resultOf(STALE))

      await expect(stale).rejects.toBeInstanceOf(DiffEvictedError)
      expect(cache.peek('br_b', 'dl_1')).toEqual(FRESH)
    })

    it('leaves a stale walk out of the cache when nothing walked after the eviction', async () => {
      const gate = deferred<WalkResult>()
      const walk = vi.fn<DiffWalk>(async () => resultOf(FRESH)).mockReturnValueOnce(gate.promise)
      const cache = createDiffCache({ walk })
      const stale = cache.populate(delta('dl_1'))
      await settle()

      cache.evictBranch('br_b')
      gate.resolve(resultOf(STALE))

      await expect(stale).rejects.toBeInstanceOf(DiffEvictedError)
      expect(cache.peek('br_b', 'dl_1')).toBeUndefined()
      await expect(cache.populate(delta('dl_1'))).resolves.toEqual({ kind: 'entry', entry: FRESH })
      expect(walk).toHaveBeenCalledTimes(2)
    })

    it('neither logs nor remembers a walk that rejects after its eviction', async () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
      const gate = deferred<WalkResult>()
      const walk = vi.fn<DiffWalk>(async () => resultOf(FRESH)).mockReturnValueOnce(gate.promise)
      const cache = createDiffCache({ walk })
      const stale = cache.populate(delta('dl_1'))
      await settle()

      cache.evictBranch('br_b')
      gate.reject(new Error('SQLITE_BUSY'))

      await expect(stale).rejects.toBeInstanceOf(DiffEvictedError)
      expect(warn).not.toHaveBeenCalled()
      await expect(cache.populate(delta('dl_1'))).resolves.toEqual({ kind: 'entry', entry: FRESH })
      expect(walk).toHaveBeenCalledTimes(2)
    })

    it('logs a throwing listener, still calls the next, and calls no unregistered one', () => {
      const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
      const cache = createDiffCache({ walk: answering() })
      const heard: string[] = []
      cache.onEvict(() => {
        throw new Error('listener broke')
      })
      const off = cache.onEvict((branchId) => heard.push(branchId))

      cache.evictBranch('br_b')
      off()
      cache.evictBranch('br_c')

      expect(heard).toEqual(['br_b'])
      expect(error).toHaveBeenCalledWith('history.evict_listener_failed', {
        branchId: 'br_b',
        error: 'listener broke',
      })
    })

    it('drops the branch before telling listeners, so a listener reads past the eviction', async () => {
      const walk = answering()
      const cache = createDiffCache({ walk })
      await cache.populate(delta('dl_1'))
      const seen: (DiffCacheEntry | undefined)[] = []
      const repopulated: Promise<unknown>[] = []
      cache.onEvict((branchId) => {
        seen.push(cache.peek(branchId, 'dl_1'))
        repopulated.push(cache.populate(delta('dl_1')))
      })

      cache.evictBranch('br_b')

      expect(seen).toEqual([undefined])
      await Promise.all(repopulated)
      expect(walk).toHaveBeenCalledTimes(2)
    })

    it('drops a remembered failure before telling listeners, so a listener walks again', async () => {
      vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
      const walk = vi
        .fn<DiffWalk>()
        .mockRejectedValueOnce(new Error('SQLITE_BUSY'))
        .mockResolvedValueOnce(resultOf(FRESH))
      const cache = createDiffCache({ walk })
      await expect(cache.populate(delta('dl_1'))).rejects.toThrow('SQLITE_BUSY')
      const repopulated: Promise<unknown>[] = []
      cache.onEvict(() => {
        repopulated.push(cache.populate(delta('dl_1')))
      })

      cache.evictBranch('br_b')

      await expect(repopulated[0]).resolves.toEqual({ kind: 'entry', entry: FRESH })
      expect(walk).toHaveBeenCalledTimes(2)
    })
  })

  describe('gone and failed walks', () => {
    it('resolves gone without caching, remembering or logging it', async () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
      const walk = vi.fn<DiffWalk>(async (requested) => ({
        entries: new Map<string, DiffCacheEntry>(),
        gone: new Set(requested.map((d) => d.id)),
      }))
      const cache = createDiffCache({ walk })

      await expect(cache.populate(delta('dl_1'))).resolves.toEqual({ kind: 'gone' })
      expect(cache.peek('br_b', 'dl_1')).toBeUndefined()
      await expect(cache.populate(delta('dl_1'))).resolves.toEqual({ kind: 'gone' })
      expect(walk).toHaveBeenCalledTimes(2)
      expect(warn).not.toHaveBeenCalled()
    })

    it('remembers a failed walk until its branch is evicted, with one warn', async () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
      const failure = new DiffWalkError('no row, head delete or held copy for lore lore_ford')
      const walk = answering().mockRejectedValueOnce(failure)
      const cache = createDiffCache({ walk })

      await expect(cache.populate(delta('dl_1'))).rejects.toBe(failure)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith('history.diff_walk_failed', {
        branchId: 'br_b',
        deltaId: 'dl_1',
        reason: 'no row, head delete or held copy for lore lore_ford',
      })

      await expect(cache.populate(delta('dl_1'))).rejects.toBe(failure)
      await expect(cache.populateBatch([delta('dl_1')])).resolves.toBeUndefined()
      expect(walk).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledTimes(1)

      cache.evictBranch('br_b')
      await expect(cache.populate(delta('dl_1'))).resolves.toEqual({
        kind: 'entry',
        entry: { old: { title: 'The ford' }, new: { title: 'dl_1 on br_b' }, names: {} },
      })
      expect(walk).toHaveBeenCalledTimes(2)
    })

    it('logs one warn per requested delta of a failed walk', async () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
      const walk = vi.fn<DiffWalk>(async () => {
        throw new Error('database is locked')
      })
      const cache = createDiffCache({ walk })

      await cache.populateBatch([delta('dl_1'), delta('dl_2')])

      expect(walk).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls).toEqual([
        [
          'history.diff_walk_failed',
          { branchId: 'br_b', deltaId: 'dl_1', reason: 'database is locked' },
        ],
        [
          'history.diff_walk_failed',
          { branchId: 'br_b', deltaId: 'dl_2', reason: 'database is locked' },
        ],
      ])
    })
  })
})
