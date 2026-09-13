// @vitest-environment jsdom
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '@/lib/cache'
import type { Entity, StoryEntry } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import type { SignalDelta } from '@/lib/row-signals'
import {
  entitiesStore,
  entriesStore,
  generationStore,
  resetAllStores,
  type RunState,
} from '@/lib/stores'

import { useRowSignals, type RowSignalsSnapshot } from './use-row-signals'

const reads = vi.hoisted(() => ({
  boundaries: vi.fn(),
  deltas: vi.fn(),
  replyEdits: vi.fn(),
}))

// The runtime `db` is a bridge client; the reads are what the hook composes.
vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  db: {},
}))
vi.mock('@/lib/row-signals', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readTurnBoundaries: reads.boundaries,
  readSignalDeltas: reads.deltas,
  readReplyEdits: reads.replyEdits,
}))

function entry(
  id: string,
  kind: StoryEntry['kind'],
  position: number,
  scene: string[],
  loc: string | null = null,
  branchId = 'br_1',
): StoryEntry {
  return {
    id,
    branchId,
    position,
    kind,
    content: '',
    chapterId: null,
    metadata: { sceneEntities: scene, currentLocationId: loc, worldTime: 0 },
    createdAt: position,
  }
}

function entity(id: string, kind: Entity['kind'], branchId = 'br_1'): Entity {
  return {
    id,
    branchId,
    kind,
    name: id,
    description: null,
    status: 'active',
    retiredReason: null,
    injectionMode: 'auto',
    nameCollisionFlag: 0,
    state: null,
    tags: [],
    keywords: [],
    priority: 0,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
  }
}

function delta(targetId: string, logPosition: number, targetTable = 'entities'): SignalDelta {
  return { source: 'periodic_classifier', targetTable, targetId, logPosition }
}

function run(id: string): RunState {
  return {
    runId: id,
    kind: 'per-turn',
    gateBehavior: 'no-gate',
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

// The read only enables once a branch has a reply; this seeds the common single-branch case.
function seedOneReply(branchId = 'br_1', scene: string[] = [], entities: Entity[] = []): void {
  entriesStore.hydrate(branchId, [
    entry('e1', 'opening', 1, [], null, branchId),
    entry('e2', 'ai_reply', 2, scene, null, branchId),
  ])
  entitiesStore.hydrate(branchId, entities)
}

let latest: RowSignalsSnapshot | null = null
let renders = 0
function Probe({ branchId = 'br_1' }: { branchId?: string }) {
  renders++
  latest = useRowSignals(branchId)
  return null
}

function renderProbe(props: { branchId?: string; client?: QueryClient } = {}) {
  const client = props.client ?? createQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <Probe branchId={props.branchId} />
    </QueryClientProvider>,
  )
}

let latestA: RowSignalsSnapshot | null = null
let latestB: RowSignalsSnapshot | null = null
function ProbeA() {
  latestA = useRowSignals('br_1')
  return null
}
function ProbeB() {
  latestB = useRowSignals('br_1')
  return null
}

describe('useRowSignals', () => {
  beforeEach(() => {
    resetAllStores()
    latest = null
    latestA = null
    latestB = null
    renders = 0
    reads.boundaries.mockReset()
    reads.deltas.mockReset()
    reads.replyEdits.mockReset()
    reads.replyEdits.mockResolvedValue([])
  })
  afterEach(() => {
    cleanup()
  })

  it('composes in-scene from the tail and recently-classified from the read window', async () => {
    entriesStore.hydrate('br_1', [
      entry('e1', 'opening', 1, []),
      entry('e2', 'user_action', 2, []),
      entry('e3', 'ai_reply', 3, ['char_a'], 'loc_1'),
      entry('e4', 'user_action', 4, ['char_a'], 'loc_1'),
      entry('e5', 'ai_reply', 5, ['char_a', 'char_b'], 'loc_1'),
    ])
    entitiesStore.hydrate('br_1', [
      entity('char_a', 'character'),
      entity('char_b', 'character'),
      entity('loc_1', 'location'),
    ])
    reads.boundaries.mockResolvedValue({ fresh: 6, fading: 3 })
    reads.deltas.mockResolvedValue([delta('char_c', 7)])

    renderProbe()

    expect([...(latest?.inScene ?? [])].sort()).toEqual(['char_a', 'char_b', 'loc_1'])
    await waitFor(() => expect(latest?.recentlyClassified.rows.get('char_c')).toBe('fresh'))
    expect(latest?.recentlyClassified.rows.get('char_b')).toBe('fresh')
    expect(latest?.recentlyClassified.byCategory.get('character')).toBe('fresh')
    expect(reads.deltas).toHaveBeenCalledWith({}, 'br_1', 3)
  })

  it('does not invoke the reads while the branch has zero replies, even though they are configured to resolve', async () => {
    entriesStore.hydrate('br_1', [entry('e1', 'opening', 1, [])])
    entitiesStore.hydrate('br_1', [entity('char_a', 'character')])
    reads.boundaries.mockResolvedValue({ fresh: 2, fading: null })
    reads.deltas.mockResolvedValue([delta('char_a', 2)])

    renderProbe()
    await act(async () => {})
    expect(reads.boundaries).not.toHaveBeenCalled()
    expect(latest?.recentlyClassified.rows.size).toBe(0)
  })

  it('never shows data seeded onto the disabled zero-reply query key', async () => {
    entriesStore.hydrate('br_1', [entry('e1', 'opening', 1, [])])
    entitiesStore.hydrate('br_1', [entity('char_a', 'character')])

    const client = createQueryClient()
    renderProbe({ client })
    await act(async () => {})

    // Stays disabled but still registers an observer; a direct cache write (bypassing the
    // mocked reads) is the only way to reach `data != null` while `latestReplyId` is null.
    const observed = client
      .getQueryCache()
      .findAll({ queryKey: ['row-signals'] })
      .filter((q) => q.getObserversCount() > 0)
    expect(observed).toHaveLength(1)

    const before = renders
    await act(async () => {
      client.setQueryData(observed[0].queryKey, {
        deltas: [delta('char_a', 2)],
        boundaries: { fresh: 2, fading: null },
      })
      // A sync act doesn't flush React Query's setTimeout(0) notify; without it, the render
      // below never fires and the assertion is vacuous.
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(renders).toBeGreaterThan(before)
    expect(latest?.recentlyClassified.rows.size).toBe(0)
  })

  it('re-reads when the generation store settles', async () => {
    seedOneReply()
    reads.boundaries.mockResolvedValue({ fresh: 2, fading: null })
    reads.deltas.mockResolvedValue([])

    renderProbe()
    await waitFor(() => expect(reads.boundaries).toHaveBeenCalledTimes(1))

    act(() => generationStore.startRun(run('r1')))
    // Negative control: starting a run alone must not trigger a re-read —
    // only its exit (a settle) does.
    await act(async () => {})
    expect(reads.boundaries).toHaveBeenCalledTimes(1)

    act(() => generationStore.finishRun('r1'))
    await waitFor(() => expect(reads.boundaries).toHaveBeenCalledTimes(2))
  })

  it('keeps the previous window visible while a same-branch refetch is pending', async () => {
    seedOneReply('br_1', ['char_a'], [entity('char_a', 'character')])
    reads.boundaries.mockResolvedValue({ fresh: 2, fading: null })
    reads.deltas.mockResolvedValue([delta('char_a', 2)])

    renderProbe()
    await waitFor(() => expect(latest?.recentlyClassified.rows.get('char_a')).toBe('fresh'))

    let resolveSecond!: (rows: SignalDelta[]) => void
    reads.deltas.mockImplementationOnce(
      () =>
        new Promise<SignalDelta[]>((resolve) => {
          resolveSecond = resolve
        }),
    )
    act(() => generationStore.startRun(run('r1')))
    act(() => generationStore.finishRun('r1'))
    await waitFor(() => expect(reads.deltas).toHaveBeenCalledTimes(2))

    // The second read is still pending — the old window must not blank out.
    expect(latest?.recentlyClassified.rows.get('char_a')).toBe('fresh')

    await act(async () => {
      resolveSecond([])
    })
  })

  it("does not carry another branch's tints into a fresh branch before its own read resolves", async () => {
    seedOneReply('br_1', ['char_a'], [entity('char_a', 'character')])
    reads.boundaries.mockResolvedValue({ fresh: 2, fading: null })
    reads.deltas.mockResolvedValue([delta('char_a', 2)])

    const client = createQueryClient()
    const { rerender } = renderProbe({ client, branchId: 'br_1' })
    await waitFor(() => expect(latest?.recentlyClassified.rows.get('char_a')).toBe('fresh'))

    let resolveSecond!: (rows: SignalDelta[]) => void
    reads.deltas.mockImplementationOnce(
      () =>
        new Promise<SignalDelta[]>((resolve) => {
          resolveSecond = resolve
        }),
    )
    act(() => {
      entriesStore.hydrate('br_2', [
        entry('f1', 'opening', 1, [], null, 'br_2'),
        entry('f2', 'ai_reply', 2, [], null, 'br_2'),
      ])
      entitiesStore.hydrate('br_2', [entity('char_x', 'character', 'br_2')])
      // Hydrate + branchId switch land in one batch — no render sees br_1 emptied in between,
      // isolating the branch guard (not the zero-replies path) as what keeps br_1's tints out.
      rerender(
        <QueryClientProvider client={client}>
          <Probe branchId="br_2" />
        </QueryClientProvider>,
      )
    })
    expect(latest?.recentlyClassified.rows.size).toBe(0)
    await waitFor(() => expect(reads.deltas).toHaveBeenCalledTimes(2))
    expect(latest?.recentlyClassified.rows.size).toBe(0)

    await act(async () => {
      resolveSecond([delta('char_x', 2)])
    })
    // Positive control: br_2's own read does land once it resolves.
    await waitFor(() => expect(latest?.recentlyClassified.rows.get('char_x')).toBe('fresh'))
  })

  it('shows the correct branch after br_1 -> br_2 -> br_1, with no leakage either direction', async () => {
    seedOneReply('br_1', ['char_a'], [entity('char_a', 'character')])
    reads.boundaries.mockResolvedValue({ fresh: 2, fading: null })
    reads.deltas.mockResolvedValueOnce([delta('char_a', 2)])

    const client = createQueryClient()
    const { rerender } = renderProbe({ client, branchId: 'br_1' })
    await waitFor(() => expect(latest?.recentlyClassified.rows.get('char_a')).toBe('fresh'))

    reads.deltas.mockResolvedValueOnce([delta('char_x', 2)])
    act(() => {
      entriesStore.hydrate('br_2', [
        entry('f1', 'opening', 1, [], null, 'br_2'),
        entry('f2', 'ai_reply', 2, [], null, 'br_2'),
      ])
      entitiesStore.hydrate('br_2', [entity('char_x', 'character', 'br_2')])
      rerender(
        <QueryClientProvider client={client}>
          <Probe branchId="br_2" />
        </QueryClientProvider>,
      )
    })
    await waitFor(() => expect(latest?.recentlyClassified.rows.get('char_x')).toBe('fresh'))
    expect(latest?.recentlyClassified.rows.has('char_a')).toBe(false)

    reads.deltas.mockResolvedValueOnce([delta('char_a', 2)])
    act(() => {
      seedOneReply('br_1', ['char_a'], [entity('char_a', 'character')])
      rerender(
        <QueryClientProvider client={client}>
          <Probe branchId="br_1" />
        </QueryClientProvider>,
      )
    })
    await waitFor(() => expect(latest?.recentlyClassified.rows.get('char_a')).toBe('fresh'))
    expect(latest?.recentlyClassified.rows.has('char_x')).toBe(false)
  })

  it('logs the read failure under its own kind, never retries, and clears the snapshot', async () => {
    seedOneReply()
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    reads.boundaries.mockRejectedValue(new Error('boom'))

    renderProbe()

    await waitFor(() => expect(warnSpy).toHaveBeenCalledTimes(1))
    expect(warnSpy).toHaveBeenCalledWith('app.row_signals_read_failed', {
      branchId: 'br_1',
      error: 'boom',
    })
    // Pins retry: false without depending on waitFor's default 1s timeout.
    expect(reads.boundaries).toHaveBeenCalledTimes(1)
    expect(reads.deltas).not.toHaveBeenCalled()
    expect(latest?.recentlyClassified.rows.size).toBe(0)

    // A real re-render (no new fetch — error/branchId unchanged) must not re-log; a render-body
    // log (vs. the effect) would fire here and bump the count.
    act(() => {
      entitiesStore.hydrate('br_1', [entity('char_z', 'character')])
    })
    expect(warnSpy).toHaveBeenCalledTimes(1)

    warnSpy.mockRestore()
  })

  it('remounting after a settle while unmounted refetches via the new key', async () => {
    seedOneReply('br_1', ['char_a'], [entity('char_a', 'character')])
    reads.boundaries.mockResolvedValue({ fresh: 2, fading: null })
    reads.deltas.mockResolvedValueOnce([])

    const client = createQueryClient()
    const { unmount } = renderProbe({ client })
    await waitFor(() => expect(reads.boundaries).toHaveBeenCalledTimes(1))
    expect(latest?.recentlyClassified.rows.size).toBe(0)
    unmount()

    // Nothing was mounted to observe this settle, but the key it produces
    // still differs — the new mount below reaches it on its own.
    act(() => generationStore.startRun(run('r1')))
    act(() => generationStore.finishRun('r1'))
    reads.deltas.mockResolvedValueOnce([delta('char_a', 2)])

    renderProbe({ client })
    await waitFor(() => expect(reads.boundaries).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(latest?.recentlyClassified.rows.get('char_a')).toBe('fresh'))
  })

  it('keeps the last good window when a refetch fails after a success, and logs once', async () => {
    seedOneReply('br_1', ['char_a'], [entity('char_a', 'character')])
    reads.boundaries.mockResolvedValueOnce({ fresh: 2, fading: null })
    reads.deltas.mockResolvedValueOnce([delta('char_a', 2)])

    renderProbe()
    await waitFor(() => expect(latest?.recentlyClassified.rows.get('char_a')).toBe('fresh'))

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    reads.boundaries.mockRejectedValueOnce(new Error('boom'))
    act(() => generationStore.startRun(run('r1')))
    act(() => generationStore.finishRun('r1'))

    await waitFor(() => expect(warnSpy).toHaveBeenCalledTimes(1))
    // The failed refetch must not blank the tint the prior success produced.
    expect(latest?.recentlyClassified.rows.get('char_a')).toBe('fresh')

    warnSpy.mockRestore()
  })

  it('drops stale tints when a rollback leaves the branch with no replies', async () => {
    seedOneReply('br_1', ['char_a'], [entity('char_a', 'character')])
    reads.boundaries.mockResolvedValue({ fresh: 2, fading: null })
    reads.deltas.mockResolvedValue([delta('char_a', 2)])

    renderProbe()
    await waitFor(() => expect(latest?.recentlyClassified.rows.get('char_a')).toBe('fresh'))

    act(() => {
      entriesStore.hydrate('br_1', [entry('e1', 'opening', 1, [])])
    })
    expect(latest?.recentlyClassified.rows.size).toBe(0)
  })

  it('does not flash the pre-rollback window when a new reply lands after a rollback to zero', async () => {
    seedOneReply('br_1', ['char_a'], [entity('char_a', 'character')])
    reads.boundaries.mockResolvedValueOnce({ fresh: 2, fading: null })
    reads.deltas.mockResolvedValueOnce([delta('char_a', 2)])

    renderProbe()
    await waitFor(() => expect(latest?.recentlyClassified.rows.get('char_a')).toBe('fresh'))

    act(() => {
      entriesStore.hydrate('br_1', [entry('e1', 'opening', 1, [])])
    })
    expect(latest?.recentlyClassified.rows.size).toBe(0)

    let resolveBoundaries!: (value: { fresh: number; fading: number | null }) => void
    reads.boundaries.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBoundaries = resolve
        }),
    )
    act(() => {
      entriesStore.hydrate('br_1', [
        entry('e1', 'opening', 1, []),
        entry('e10', 'user_action', 2, []),
        entry('e11', 'ai_reply', 3, ['char_a']),
      ])
    })
    // The new turn's read is still pending — the pre-rollback window must not
    // flash back in while lastGood is being repopulated.
    expect(latest?.recentlyClassified.rows.size).toBe(0)

    reads.deltas.mockResolvedValueOnce([delta('char_a', 4)])
    await act(async () => {
      resolveBoundaries({ fresh: 4, fading: null })
    })
    // Positive control: once the new read resolves, its own window lands.
    await waitFor(() => expect(latest?.recentlyClassified.rows.get('char_a')).toBe('fresh'))
  })

  it('shares one read across two instances on the same branch after a settle', async () => {
    seedOneReply()
    reads.boundaries.mockResolvedValue({ fresh: 2, fading: null })
    let currentDeltas: SignalDelta[] = []
    reads.deltas.mockImplementation(async () => currentDeltas)

    const client = createQueryClient()
    render(
      <QueryClientProvider client={client}>
        <ProbeB />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(reads.deltas).toHaveBeenCalledTimes(1))

    act(() => generationStore.startRun(run('r1')))
    act(() => generationStore.finishRun('r1'))
    await waitFor(() => expect(reads.deltas).toHaveBeenCalledTimes(2))

    render(
      <QueryClientProvider client={client}>
        <ProbeA />
      </QueryClientProvider>,
    )
    // A mounts onto B's already-settled key — the shared cache serves it with no extra read;
    // closing the per-instance-epoch gap: one shared key space, so a settle never strands anyone.
    expect(reads.deltas).toHaveBeenCalledTimes(2)
    expect(latestA?.recentlyClassified.rows.size).toBe(0)

    currentDeltas = [delta('char_a', 2)]
    act(() => generationStore.startRun(run('r2')))
    act(() => generationStore.finishRun('r2'))
    await waitFor(() => {
      expect(latestA?.recentlyClassified.rows.get('char_a')).toBe('fresh')
      expect(latestB?.recentlyClassified.rows.get('char_a')).toBe('fresh')
    })
    expect(reads.deltas).toHaveBeenCalledTimes(3)
  })

  it('re-reads when an older reply loads in under an unchanged latest reply', async () => {
    // A window holding one reply; loadOlderEntries then patches the previous one in.
    entriesStore.hydrate('br_1', [
      entry('e3', 'user_action', 3, []),
      entry('e4', 'ai_reply', 4, []),
    ])
    entitiesStore.hydrate('br_1', [entity('char_a', 'character')])
    reads.boundaries
      .mockResolvedValueOnce({ fresh: 4, fading: null })
      .mockResolvedValueOnce({ fresh: 4, fading: 2 })
    reads.deltas.mockResolvedValueOnce([]).mockResolvedValueOnce([delta('char_a', 3)])

    renderProbe()
    await waitFor(() => expect(reads.boundaries).toHaveBeenCalledTimes(1))

    act(() => {
      entriesStore.patch('br_1', { op: 'create', id: 'e2', row: entry('e2', 'ai_reply', 2, []) })
    })
    await waitFor(() => expect(latest?.recentlyClassified.rows.get('char_a')).toBe('fading'))
    expect(reads.deltas).toHaveBeenLastCalledWith({}, 'br_1', 2)
  })

  it('sorts entries by position before reading, regardless of Map insertion order', async () => {
    // loadOlderEntries inserts older rows after newer ones in the Map.
    entriesStore.hydrate('br_1', [entry('e2', 'ai_reply', 2, []), entry('e1', 'opening', 1, [])])
    entitiesStore.hydrate('br_1', [])
    reads.boundaries.mockResolvedValue({ fresh: 2, fading: null })
    reads.deltas.mockResolvedValue([])

    renderProbe()
    await waitFor(() => expect(reads.boundaries).toHaveBeenCalledTimes(1))
    const passedEntries = reads.boundaries.mock.calls[0]?.[2] as StoryEntry[] | undefined
    expect(passedEntries?.map((e) => e.id)).toEqual(['e1', 'e2'])
  })

  it('does not read when the store holds a different branch than requested', async () => {
    entriesStore.hydrate('br_2', [
      entry('f1', 'opening', 1, [], null, 'br_2'),
      entry('f2', 'ai_reply', 2, [], null, 'br_2'),
    ])
    entitiesStore.hydrate('br_2', [entity('char_x', 'character', 'br_2')])

    renderProbe({ branchId: 'br_1' })
    await act(async () => {})
    expect(reads.boundaries).not.toHaveBeenCalled()
    expect(latest?.recentlyClassified.rows.size).toBe(0)
    expect(latest?.inScene.size).toBe(0)
  })

  it('diffs the scene its window read, so a manual scene edit in the store tints nothing', async () => {
    seedOneReply('br_1', ['char_a'], [entity('char_a', 'character'), entity('char_b', 'character')])
    reads.boundaries.mockResolvedValue({ fresh: 2, fading: null })
    reads.deltas.mockResolvedValue([])

    renderProbe()
    await waitFor(() => expect(latest?.recentlyClassified.rows.get('char_a')).toBe('fresh'))
    expect(reads.replyEdits).toHaveBeenCalledWith({}, 'br_1', ['e2'])

    // The user adds char_b by hand: the store takes it at once, and nothing settles.
    act(() => {
      entriesStore.hydrate('br_1', [
        entry('e1', 'opening', 1, []),
        entry('e2', 'ai_reply', 2, ['char_a', 'char_b']),
      ])
    })
    expect(latest?.inScene.has('char_b')).toBe(true)
    expect(reads.boundaries).toHaveBeenCalledTimes(1)
    expect(latest?.recentlyClassified.rows.get('char_a')).toBe('fresh')
    expect(latest?.recentlyClassified.rows.has('char_b')).toBe(false)
  })

  it("feeds the window's reply edits to the scene pass", async () => {
    entriesStore.hydrate('br_1', [
      entry('e1', 'opening', 1, ['char_a']),
      entry('e2', 'ai_reply', 2, ['char_a', 'char_b']),
    ])
    entitiesStore.hydrate('br_1', [entity('char_a', 'character'), entity('char_b', 'character')])
    reads.boundaries.mockResolvedValue({ fresh: 2, fading: null })
    reads.deltas.mockResolvedValue([delta('char_c', 2)])
    // char_b was added by hand before this read; the edit's undo payload holds the prior scene.
    reads.replyEdits.mockResolvedValue([
      { targetId: 'e2', logPosition: 3, undoPayload: { metadata: { sceneEntities: ['char_a'] } } },
    ])

    renderProbe()
    // Positive control: the window has landed, so the absence below means something.
    await waitFor(() => expect(latest?.recentlyClassified.rows.get('char_c')).toBe('fresh'))
    expect(latest?.recentlyClassified.rows.has('char_b')).toBe(false)
  })
})
