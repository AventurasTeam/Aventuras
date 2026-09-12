// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { embedderSwapStore, embeddingStatusStore } from '@/lib/stores'

import { memoryPillError, useMemoryHealth, type MemoryHealth } from './use-memory-health'

const HEALTHY: MemoryHealth = { staleTotal: 0, swapRunning: false, swapPaused: false }

describe('memoryPillError', () => {
  it('is undefined for a healthy story', () => {
    expect(memoryPillError(HEALTHY)).toBeUndefined()
  })

  it('reports pending rows as memory-incomplete', () => {
    expect(memoryPillError({ ...HEALTHY, staleTotal: 3 })).toEqual({
      code: 'memory-incomplete',
      pendingRows: 3,
    })
  })

  // Staging clears stale rows as it goes, so the marker outranks the count.
  it('ranks a paused swap above pending rows', () => {
    expect(memoryPillError({ ...HEALTHY, staleTotal: 3, swapPaused: true })).toEqual({
      code: 'swap-paused',
    })
  })

  it('reports a running swap by its pending rows alone', () => {
    expect(memoryPillError({ ...HEALTHY, swapRunning: true })).toBeUndefined()
    expect(memoryPillError({ ...HEALTHY, staleTotal: 2, swapRunning: true })).toEqual({
      code: 'memory-incomplete',
      pendingRows: 2,
    })
  })
})

let latest: MemoryHealth | null = null

function Probe({ storyId, swapTarget }: { storyId: string | null; swapTarget?: string | null }) {
  latest = useMemoryHealth(storyId, swapTarget)
  return null
}

describe('useMemoryHealth', () => {
  beforeEach(() => {
    embeddingStatusStore.__reset()
    embedderSwapStore.__reset()
    latest = null
  })

  afterEach(cleanup)

  it("reads the story's stale count", () => {
    embeddingStatusStore.setStatus('s1', 4)
    render(<Probe storyId="s1" />)
    expect(latest).toEqual({ ...HEALTHY, staleTotal: 4 })
  })

  it("ignores another story's stale count", () => {
    embeddingStatusStore.setStatus('s2', 4)
    render(<Probe storyId="s1" />)
    expect(latest?.staleTotal).toBe(0)
    // Positive control: the same slot reads for its own story.
    cleanup()
    render(<Probe storyId="s2" />)
    expect(latest?.staleTotal).toBe(4)
  })

  it('reads a swap marker with no live run as paused', () => {
    render(<Probe storyId="s1" swapTarget="model-b" />)
    expect(latest).toEqual({ ...HEALTHY, swapPaused: true })
  })

  it('reads a swap marker with a live run as running, not paused', () => {
    embedderSwapStore.beginProgress('s1')
    render(<Probe storyId="s1" swapTarget="model-b" />)
    expect(latest).toEqual({ ...HEALTHY, swapRunning: true })
  })

  it('reports no swap without a story or a marker', () => {
    render(<Probe storyId={null} swapTarget="model-b" />)
    expect(latest).toEqual(HEALTHY)
    cleanup()
    render(<Probe storyId="s1" swapTarget={null} />)
    expect(latest).toEqual(HEALTHY)
  })
})
