// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '@/lib/cache'
import type { ChapterTimeRanges } from '@/lib/db'
import { resetAllStores } from '@/lib/stores'

import { useTimelineTimeRanges } from './use-timeline-time-ranges'

const reads = vi.hoisted(() => ({ ranges: vi.fn() }))

// The runtime `db` is a bridge client; the read is what the hook composes.
vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  db: {},
  readChapterTimeRanges: reads.ranges,
}))

function ranges(first: number, last: number): ChapterTimeRanges {
  return new Map([['chap_1', { first, last }]])
}

let latest: ChapterTimeRanges | null = null

function Probe({ focused }: { focused: boolean }) {
  latest = useTimelineTimeRanges('br_1', focused)
  return null
}

function renderProbe(focused: boolean) {
  const client = createQueryClient()
  const view = (next: boolean) => (
    <QueryClientProvider client={client}>
      <Probe focused={next} />
    </QueryClientProvider>
  )
  const { rerender } = render(view(focused))
  return { setFocused: (next: boolean) => rerender(view(next)) }
}

const shown = () => latest?.get('chap_1')

describe('useTimelineTimeRanges', () => {
  beforeEach(() => {
    resetAllStores()
    latest = null
    reads.ranges.mockReset()
  })
  afterEach(() => {
    cleanup()
  })

  it('rereads on a return to focus with the key unchanged', async () => {
    reads.ranges.mockResolvedValue(ranges(120, 300))
    const { setFocused } = renderProbe(true)
    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 300 }))

    setFocused(false)
    reads.ranges.mockResolvedValue(ranges(120, 900))
    const readsBeforeReturn = reads.ranges.mock.calls.length
    await act(async () => {})
    expect(reads.ranges).toHaveBeenCalledTimes(readsBeforeReturn)
    expect(shown()).toEqual({ first: 120, last: 300 })

    setFocused(true)
    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 900 }))
  })

  it('reads nothing while unfocused', async () => {
    renderProbe(false)
    await act(async () => {})

    expect(reads.ranges).not.toHaveBeenCalled()
    expect(latest?.size).toBe(0)
  })

  it('rereads once per return, not on each render', async () => {
    reads.ranges.mockResolvedValue(ranges(120, 300))
    const { setFocused } = renderProbe(true)
    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 300 }))

    const readsBefore = reads.ranges.mock.calls.length
    setFocused(true)
    setFocused(true)
    await act(async () => {})
    expect(reads.ranges).toHaveBeenCalledTimes(readsBefore)
  })
})
