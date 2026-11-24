// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '@/lib/cache'
import type { Delta } from '@/lib/db'
import {
  createDiffCache,
  type DiffCacheEntry,
  type DiffOutcome,
  type DiffWalk,
  type HistoryRow,
  type UpdateDelta,
} from '@/lib/history'

import { DiffLoaderProvider, type DiffLoader } from './diff-loader'
import { useDiffOutcomes } from './use-diff-outcomes'

const B1 = 'br_1'
const B2 = 'br_2'

const voiceUpdate = (branchId: string, id: string): UpdateDelta => ({
  id,
  branchId,
  entryId: null,
  actionId: 'act_1',
  logPosition: 3,
  source: 'user_edit',
  targetTable: 'entities',
  targetId: `char_${branchId}`,
  op: 'update',
  undoPayload: { state: { voice: 'low' } },
  encodingVersion: 1,
  createdAt: 0,
})

const own = (delta: Delta): HistoryRow => ({ delta, via: { kind: 'own' } })

const voiceEntry = (voice: string): DiffCacheEntry => ({
  old: { state: { voice: 'low' } },
  new: { state: { voice } },
  names: {},
})

const GRAVELLY = voiceEntry('gravelly')
const HOARSE = voiceEntry('hoarse')

const walked = (entries: Record<string, DiffCacheEntry>): Awaited<ReturnType<DiffWalk>> => ({
  entries: new Map(Object.entries(entries)),
  gone: new Set(),
})

// TanStack notifies observers on a timer, so a "nothing changed" check waits past it.
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)))

type Outcomes = ReadonlyMap<string, DiffOutcome>

function renderOutcomes(
  loader: DiffLoader,
  rows: readonly HistoryRow[],
  // Runs in a sibling's layout effect: after the hook's render commits, before its effects.
  beforeEffects: () => void = () => {},
) {
  // `returned` holds every map the hook handed out, so a flash between two checks shows.
  const seen: { current: Outcomes | null; returned: Outcomes[] } = { current: null, returned: [] }
  function Probe({ shown }: { shown: readonly HistoryRow[] }) {
    seen.current = useDiffOutcomes(shown)
    seen.returned.push(seen.current)
    return null
  }
  function BeforeEffects() {
    useLayoutEffect(beforeEffects, [])
    return null
  }
  const client = createQueryClient()
  const tree = (shown: readonly HistoryRow[]) => (
    <QueryClientProvider client={client}>
      <DiffLoaderProvider value={loader}>
        <Probe shown={shown} />
        <BeforeEffects />
      </DiffLoaderProvider>
    </QueryClientProvider>
  )
  const view = render(tree(rows))
  return { seen, setRows: (next: readonly HistoryRow[]) => view.rerender(tree(next)) }
}

afterEach(cleanup)

describe('useDiffOutcomes', () => {
  it('re-reads a row seeded from the cache when its branch is evicted before the hook subscribes', async () => {
    const walk = vi
      .fn<DiffWalk>()
      .mockResolvedValueOnce(walked({ d1: GRAVELLY }))
      .mockResolvedValueOnce(walked({ d1: HOARSE }))
    const cache = createDiffCache({ walk })
    const d1 = voiceUpdate(B1, 'd1')
    await cache.populate(d1)
    const { seen } = renderOutcomes(cache, [own(d1)], () => cache.evictBranch(B1))
    await waitFor(() => expect(seen.current?.get('d1')).toEqual({ kind: 'entry', entry: HOARSE }))
    expect(walk).toHaveBeenCalledTimes(2)
  })

  it('re-reads a seed the cache no longer counts current, though it holds an entry for the row', async () => {
    const peek = vi.fn<DiffLoader['peek']>().mockReturnValueOnce(GRAVELLY).mockReturnValue(HOARSE)
    const populate = vi.fn<DiffLoader['populate']>(async () => ({ kind: 'entry', entry: HOARSE }))
    const isCurrent = (_branchId: string, entry: DiffCacheEntry) => entry === HOARSE
    const { seen } = renderOutcomes({ peek, populate, isCurrent, onEvict: () => () => {} }, [
      own(voiceUpdate(B1, 'd1')),
    ])
    await waitFor(() => expect(seen.current?.get('d1')).toEqual({ kind: 'entry', entry: HOARSE }))
    expect(populate).toHaveBeenCalledTimes(1)
  })

  it('keeps a seed the cache still holds, reading nothing on mount', async () => {
    const cache = createDiffCache({ walk: async () => walked({ d1: GRAVELLY }) })
    const d1 = voiceUpdate(B1, 'd1')
    await cache.populate(d1)
    const populate = vi.spyOn(cache, 'populate')
    const { seen } = renderOutcomes(cache, [own(d1)])
    expect(seen.current?.get('d1')).toEqual({ kind: 'entry', entry: GRAVELLY })
    await settle()
    expect(populate).not.toHaveBeenCalled()
    expect(seen.current?.get('d1')).toEqual({ kind: 'entry', entry: GRAVELLY })
  })

  it("keys each row on its own delta's branch, so an eviction re-reads that branch's rows", async () => {
    const walk = vi
      .fn<DiffWalk>()
      .mockImplementation(async ([delta]) =>
        walked({ [delta.id]: walk.mock.calls.length > 2 ? HOARSE : GRAVELLY }),
      )
    const cache = createDiffCache({ walk })
    const d1 = voiceUpdate(B1, 'd1')
    const d2 = voiceUpdate(B2, 'd2')
    await cache.populate(d1)
    await cache.populate(d2)
    const { seen } = renderOutcomes(cache, [own(d1), own(d2)])
    await settle()
    expect(seen.current?.get('d2')).toEqual({ kind: 'entry', entry: GRAVELLY })

    const populate = vi.spyOn(cache, 'populate')
    act(() => cache.evictBranch(B2))
    await waitFor(() => expect(seen.current?.get('d2')).toEqual({ kind: 'entry', entry: HOARSE }))
    await settle()
    expect(walk).toHaveBeenCalledTimes(3)
    expect(populate.mock.calls.map(([delta]) => delta.id)).toEqual(['d2'])
    expect(seen.current?.get('d1')).toEqual({ kind: 'entry', entry: GRAVELLY })
  })

  it('keeps a re-read entry equal to the one it replaced, reading nothing when the rows change', async () => {
    // A fresh object per walk: the re-read after the eviction equals the first read, but isn't it.
    const walk = vi.fn<DiffWalk>(async () => walked({ d1: voiceEntry('gravelly') }))
    const cache = createDiffCache({ walk })
    const d1 = voiceUpdate(B1, 'd1')
    const { seen, setRows } = renderOutcomes(cache, [own(d1)])
    await waitFor(() => expect(seen.current?.get('d1')).toEqual({ kind: 'entry', entry: GRAVELLY }))
    act(() => cache.evictBranch(B1))
    await waitFor(() => expect(walk).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(seen.current?.get('d1')).toEqual({ kind: 'entry', entry: GRAVELLY }))
    await settle()

    // Slow, so a needless re-read would render the summary before it lands.
    const read = cache.populate
    const populate = vi.spyOn(cache, 'populate').mockImplementation(async (delta) => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return read(delta)
    })
    const before = seen.returned.length
    setRows([own(d1)])
    await settle()
    expect(populate).not.toHaveBeenCalled()
    expect(walk).toHaveBeenCalledTimes(2)
    expect(seen.returned.length).toBeGreaterThan(before)
    for (const outcomes of seen.returned.slice(before))
      expect(outcomes.get('d1')).toEqual({ kind: 'entry', entry: GRAVELLY })
  })

  it('walks nothing again for an entry the LRU dropped when the rows change', async () => {
    // d1 goes in first, so the one-entry cache drops it for d0 from the same walk.
    const walk = vi.fn<DiffWalk>(async () => walked({ d1: GRAVELLY, d0: HOARSE }))
    const cache = createDiffCache({ walk, capacity: 1 })
    const d1 = voiceUpdate(B1, 'd1')
    const { seen, setRows } = renderOutcomes(cache, [own(d1)])
    await waitFor(() => expect(seen.current?.get('d1')).toEqual({ kind: 'entry', entry: GRAVELLY }))
    expect(cache.peek(B1, 'd1')).toBeUndefined()

    setRows([own(d1)])
    await settle()
    expect(walk).toHaveBeenCalledTimes(1)
  })

  it('re-reads a first read an eviction overtook after the cache resolved it, never showing it', async () => {
    const walk = vi
      .fn<DiffWalk>()
      .mockResolvedValueOnce(walked({ d1: GRAVELLY }))
      .mockResolvedValueOnce(walked({ d1: HOARSE }))
    const cache = createDiffCache({ walk })
    let overtaken = false
    const loader: DiffLoader = {
      ...cache,
      async populate(delta) {
        const outcome = await cache.populate(delta)
        if (!overtaken) {
          overtaken = true
          cache.evictBranch(delta.branchId)
        }
        return outcome
      },
    }
    const { seen } = renderOutcomes(loader, [own(voiceUpdate(B1, 'd1'))])
    await waitFor(() => expect(seen.current?.get('d1')).toEqual({ kind: 'entry', entry: HOARSE }))
    expect(seen.returned.map((outcomes) => outcomes.get('d1'))).not.toContainEqual({
      kind: 'entry',
      entry: GRAVELLY,
    })
  })
})
