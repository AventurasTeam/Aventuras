// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '@/lib/cache'
import { branches, chapters, stories } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { logger } from '@/lib/diagnostics'
import {
  generationStore,
  readStoryChapterNumbers,
  resetAllStores,
  type RunState,
} from '@/lib/stores'

import { useStoryChapterNumbers } from './use-story-chapter-numbers'

type TestDb = Awaited<ReturnType<typeof createTestDb>>['db']

const app = vi.hoisted(() => ({ db: null as unknown }))

// The hook reads the app database, which a unit test swaps for an in-memory one.
vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  get db() {
    return app.db
  },
}))

async function seedStory(db: TestDb, storyId: string, currentBranchId: string | null) {
  await db.insert(stories).values({
    id: storyId,
    title: storyId,
    createdAt: 1,
    updatedAt: 1,
    currentBranchId,
  })
}

async function seedBranch(db: TestDb, id: string, storyId: string) {
  await db.insert(branches).values({ id, storyId, name: id, createdAt: 1 })
}

async function closeChapter(db: TestDb, branchId: string, sequenceNumber: number) {
  await db.insert(chapters).values({
    id: `${branchId}_chap_${sequenceNumber}`,
    branchId,
    sequenceNumber,
    title: `Chapter ${sequenceNumber}`,
    summary: 'summary',
    theme: 'theme',
    startEntryId: 'start',
    endEntryId: 'end',
    tokenCount: 0,
    closedAt: 1,
    createdAt: 1,
    updatedAt: 1,
  })
}

function run(id: string): RunState {
  return {
    runId: id,
    kind: 'per-turn',
    gateBehavior: 'hard-gate',
    interruptible: null,
    beforeTurn: false,
    actionId: `act_${id}`,
    storyId: 's1',
    branchId: 'br_1',
    abortController: new AbortController(),
    currentPhase: '',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  }
}

let shown: (ReadonlyMap<string, number> | null)[] = []
const latest = () => shown.at(-1)

function Probe({ focused }: { focused: boolean }) {
  shown.push(useStoryChapterNumbers(focused))
  return null
}

function renderProbe(focused = true) {
  const client = createQueryClient()
  const tree = (next: boolean) => (
    <QueryClientProvider client={client}>
      <Probe focused={next} />
    </QueryClientProvider>
  )
  const { rerender } = render(tree(focused))
  return { client, setFocused: (next: boolean) => rerender(tree(next)) }
}

describe('readStoryChapterNumbers', () => {
  it('reads the highest sequence number plus one on each current branch', async () => {
    const { db } = await createTestDb()
    await seedStory(db, 's1', 'br_1')
    await seedBranch(db, 'br_1', 's1')
    await closeChapter(db, 'br_1', 1)
    await closeChapter(db, 'br_1', 2)
    await seedStory(db, 's2', 'br_2')
    await seedBranch(db, 'br_2', 's2')
    await closeChapter(db, 'br_2', 1)
    await seedStory(db, 's3', 'br_3')
    await seedBranch(db, 'br_3', 's3')
    await closeChapter(db, 'br_3', 2)

    expect(await readStoryChapterNumbers(db)).toEqual(
      new Map([
        ['s1', 3],
        ['s2', 2],
        ['s3', 3],
      ]),
    )
  })

  it('has no key for a story with no closed chapter, or with no branch', async () => {
    const { db } = await createTestDb()
    await seedStory(db, 's1', 'br_1')
    await seedBranch(db, 'br_1', 's1')
    await seedStory(db, 'draft', null)

    expect(await readStoryChapterNumbers(db)).toEqual(new Map())
  })

  it('ignores chapters on a branch that is not the current one', async () => {
    const { db } = await createTestDb()
    await seedStory(db, 's1', 'br_main')
    await seedBranch(db, 'br_main', 's1')
    await seedBranch(db, 'br_fork', 's1')
    await closeChapter(db, 'br_main', 1)
    await closeChapter(db, 'br_fork', 1)
    await closeChapter(db, 'br_fork', 2)

    expect(await readStoryChapterNumbers(db)).toEqual(new Map([['s1', 2]]))
  })
})

describe('useStoryChapterNumbers', () => {
  let db: TestDb

  beforeEach(async () => {
    resetAllStores()
    shown = []
    db = (await createTestDb()).db
    app.db = db
    await seedStory(db, 's1', 'br_1')
    await seedBranch(db, 'br_1', 's1')
    await closeChapter(db, 'br_1', 1)
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('returns null until the first read lands, then the numbers', async () => {
    renderProbe()
    expect(shown[0]).toBeNull()
    await waitFor(() => expect(latest()?.get('s1')).toBe(2))
  })

  it('reads again on a settleCount tick, through the key', async () => {
    renderProbe()
    await waitFor(() => expect(latest()?.get('s1')).toBe(2))

    await closeChapter(db, 'br_1', 2)
    act(() => generationStore.startRun(run('r1')))
    // Negative control: starting a run moves no key, so the new chapter isn't read yet.
    await act(async () => {})
    expect(latest()?.get('s1')).toBe(2)

    act(() => generationStore.finishRun('r1'))
    await waitFor(() => expect(latest()?.get('s1')).toBe(3))
  })

  it('holds the last numbers while a new key reads', async () => {
    renderProbe()
    await waitFor(() => expect(latest()?.get('s1')).toBe(2))
    const firstLanded = shown.findIndex((numbers) => numbers != null)

    await closeChapter(db, 'br_1', 2)
    act(() => generationStore.startRun(run('r1')))
    act(() => generationStore.finishRun('r1'))
    await waitFor(() => expect(latest()?.get('s1')).toBe(3))

    expect(shown.slice(firstLanded)).not.toContain(null)
  })

  // The story list's cards memo keys on this object: a settle that moved no number keeps it.
  it('keeps the same object when a read returns the same numbers', async () => {
    const { client, setFocused } = renderProbe()
    await waitFor(() => expect(latest()?.get('s1')).toBe(2))
    const first = latest()

    act(() => generationStore.startRun(run('r1')))
    act(() => generationStore.finishRun('r1'))
    const key = ['story-chapter-numbers', generationStore.getSettleCount()]
    await waitFor(() => expect(client.getQueryState(key)?.status).toBe('success'))
    expect(client.getQueryData(key)).not.toBe(first)
    expect(client.getQueryData(key)).toEqual(first)
    // A render now reads the landed result, whenever the query's own notify arrives.
    setFocused(true)

    expect(latest()).toBe(first)
  })

  it('returns the new numbers when a story drops out of the read', async () => {
    renderProbe()
    await waitFor(() => expect(latest()?.get('s1')).toBe(2))

    await db.delete(chapters)
    act(() => generationStore.startRun(run('r1')))
    act(() => generationStore.finishRun('r1'))

    await waitFor(() => expect(latest()?.size).toBe(0))
  })

  it('reads again on a return to focus, with the key unchanged', async () => {
    const { setFocused } = renderProbe()
    await waitFor(() => expect(latest()?.get('s1')).toBe(2))
    const settleCount = generationStore.getSettleCount()

    setFocused(false)
    await closeChapter(db, 'br_1', 2)
    await act(async () => {})
    expect(latest()?.get('s1')).toBe(2)

    setFocused(true)
    await waitFor(() => expect(latest()?.get('s1')).toBe(3))
    expect(generationStore.getSettleCount()).toBe(settleCount)
  })

  it('reads and renders nothing while hidden, then reads once on the return', async () => {
    const { setFocused } = renderProbe()
    await waitFor(() => expect(latest()?.get('s1')).toBe(2))
    const firstLanded = shown.findIndex((numbers) => numbers != null)
    const lastFocused = latest()
    const select = vi.spyOn(db, 'select')

    setFocused(false)
    const hiddenRenders = shown.length
    await closeChapter(db, 'br_1', 2)
    for (const id of ['r1', 'r2', 'r3', 'r4', 'r5']) {
      act(() => generationStore.startRun(run(id)))
      act(() => generationStore.finishRun(id))
    }
    await act(async () => {})
    await act(async () => {})

    expect(select).not.toHaveBeenCalled()
    expect(shown.length).toBe(hiddenRenders)
    expect(latest()).toBe(lastFocused)

    setFocused(true)
    await waitFor(() => expect(latest()?.get('s1')).toBe(3))
    await act(async () => {})
    await act(async () => {})

    expect(select).toHaveBeenCalledTimes(1)
    expect(shown.slice(firstLanded).map((numbers) => numbers?.get('s1'))).not.toContain(undefined)
  })

  it('logs a failed read', async () => {
    const warn = vi.spyOn(logger, 'warn')
    const { setFocused } = renderProbe()
    await waitFor(() => expect(latest()?.get('s1')).toBe(2))

    vi.spyOn(db, 'select').mockImplementation(() => {
      throw new Error('bridge down')
    })
    setFocused(false)
    setFocused(true)

    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith('app.story_chapter_numbers_read_failed', {
        error: 'bridge down',
      }),
    )
    expect(latest()?.get('s1')).toBe(2)
  })

  // A failed read on a new key leaves data undefined: only the hook's own hold keeps the number.
  it('keeps the last numbers when a read on a new key fails', async () => {
    renderProbe()
    await waitFor(() => expect(latest()?.get('s1')).toBe(2))

    vi.spyOn(logger, 'warn').mockImplementation(() => {})
    vi.spyOn(db, 'select').mockImplementation(() => {
      throw new Error('bridge down')
    })
    act(() => generationStore.startRun(run('r1')))
    act(() => generationStore.finishRun('r1'))
    await act(async () => {})
    await act(async () => {})

    expect(latest()?.get('s1')).toBe(2)
  })

  // The list stays mounted under the reader, and more than one observer can sit on the key.
  it('logs a failed read once across mounted instances', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const select = vi.spyOn(db, 'select').mockImplementation(() => {
      throw new Error('bridge down')
    })

    render(
      <QueryClientProvider client={createQueryClient()}>
        <Probe focused />
        <Probe focused />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(warn).toHaveBeenCalled())
    await act(async () => {})
    expect(select).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
