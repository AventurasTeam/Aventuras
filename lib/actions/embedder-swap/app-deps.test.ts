import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildStorySettings, type DbCtx } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { currentStoryStore, embedderSwapStore, rehydrateStories, storiesStore } from '@/lib/stores'

import {
  cancelStorySwap,
  makeCallbackGuards,
  runExclusive,
  startStorySwap,
  SwapBusyError,
} from './app-deps'
import { startSwap } from './engine'

vi.mock('./engine', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, startSwap: vi.fn() }
})

const MINILM = 'Xenova/all-MiniLM-L6-v2'

describe('runExclusive single-flight lock', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects a concurrent second call for the same story with SwapBusyError', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const first = runExclusive('s1', () => gate.then(() => 'first' as const))
    await expect(runExclusive('s1', async () => 'second')).rejects.toBeInstanceOf(SwapBusyError)

    release()
    await expect(first).resolves.toBe('first')
    // Lock released on settle: a fresh call for the same story now succeeds.
    await expect(runExclusive('s1', async () => 'again')).resolves.toBe('again')
  })

  it('allows concurrent calls for different stories', async () => {
    let releaseA: () => void = () => {}
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve
    })

    const a = runExclusive('sA', () => gateA.then(() => 'A' as const))
    await expect(runExclusive('sB', async () => 'B')).resolves.toBe('B')

    releaseA()
    await expect(a).resolves.toBe('A')
  })

  it('releases the lock when the wrapped fn rejects', async () => {
    await expect(
      runExclusive('s1', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    await expect(runExclusive('s1', async () => 'ok')).resolves.toBe('ok')
  })
})

describe('callback guards', () => {
  afterEach(() => {
    embedderSwapStore.__reset()
    vi.restoreAllMocks()
  })

  it('a throwing onProgress never propagates out of the guard', () => {
    vi.spyOn(embedderSwapStore, 'setProgress').mockImplementation(() => {
      throw new Error('ui blew up')
    })
    const guards = makeCallbackGuards('s1')
    expect(() => guards.onProgress(1, 4)).not.toThrow()
  })

  it('isCancelRequested reflects the store flag', () => {
    const guards = makeCallbackGuards('s1')
    expect(guards.isCancelRequested()).toBe(false)
    embedderSwapStore.requestCancel()
    expect(guards.isCancelRequested()).toBe(true)
  })

  it('isCancelRequested defaults to false when the store read throws', () => {
    vi.spyOn(embedderSwapStore, 'getState').mockImplementation(() => {
      throw new Error('store gone')
    })
    expect(makeCallbackGuards('s1').isCancelRequested()).toBe(false)
  })
})

describe('stale cancel-flag isolation across operations', () => {
  afterEach(() => {
    storiesStore.__reset()
    currentStoryStore.__reset()
    embedderSwapStore.__reset()
    vi.restoreAllMocks()
  })

  async function seedStory(): Promise<DbCtx> {
    const { db, sqlite, runInTransaction } = await createTestDb()
    const settings = buildStorySettings({}, MINILM, null)
    sqlite
      .prepare(
        'INSERT INTO stories (id, title, settings, created_at, updated_at) VALUES (?,?,?,?,?)',
      )
      .run('s1', 'S', JSON.stringify(settings), 1000, 1000)
    sqlite
      .prepare('INSERT INTO branches (id, story_id, name, created_at) VALUES (?,?,?,?)')
      .run('b1', 's1', 'main', 1000)
    await rehydrateStories(db)
    return { db, runInTransaction }
  }

  it('a cancel with nothing running does not poison the next swap', async () => {
    const ctx = await seedStory()

    // A cancel against a story with no in-flight swap sets the global flag, then
    // must clear it before returning.
    await cancelStorySwap('s1', ctx)
    expect(embedderSwapStore.getState().cancelRequested).toBe(false)

    let firstPoll: boolean | undefined
    vi.mocked(startSwap).mockImplementation(async (deps) => {
      firstPoll = deps.isCancelRequested()
      return 'completed'
    })

    const result = await startStorySwap('s1', MINILM, ctx)

    expect(startSwap).toHaveBeenCalledOnce()
    expect(firstPoll).toBe(false)
    expect(result).toBe('completed')
  })
})
