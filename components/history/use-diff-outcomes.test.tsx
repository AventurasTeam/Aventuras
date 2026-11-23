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
  const seen: { current: Outcomes | null } = { current: null }
  function Probe() {
    seen.current = useDiffOutcomes(B1, rows)
    return null
  }
  function BeforeEffects() {
    useLayoutEffect(beforeEffects, [])
    return null
  }
  render(
    <QueryClientProvider client={createQueryClient()}>
      <DiffLoaderProvider value={loader}>
        <Probe />
        <BeforeEffects />
      </DiffLoaderProvider>
    </QueryClientProvider>,
  )
  return seen
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
    const seen = renderOutcomes(cache, [own(d1)], () => cache.evictBranch(B1))
    await waitFor(() => expect(seen.current?.get('d1')).toEqual({ kind: 'entry', entry: HOARSE }))
    expect(walk).toHaveBeenCalledTimes(2)
  })

  it('re-reads a seed the cache has since replaced, though the cache holds an entry again', async () => {
    const peek = vi.fn<DiffLoader['peek']>().mockReturnValueOnce(GRAVELLY).mockReturnValue(HOARSE)
    const populate = vi.fn<DiffLoader['populate']>(async () => ({ kind: 'entry', entry: HOARSE }))
    const seen = renderOutcomes({ peek, populate, onEvict: () => () => {} }, [
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
    const seen = renderOutcomes(cache, [own(d1)])
    expect(seen.current?.get('d1')).toEqual({ kind: 'entry', entry: GRAVELLY })
    await settle()
    expect(populate).not.toHaveBeenCalled()
    expect(seen.current?.get('d1')).toEqual({ kind: 'entry', entry: GRAVELLY })
  })
})
