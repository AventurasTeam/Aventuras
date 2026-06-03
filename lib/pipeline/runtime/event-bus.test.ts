import { describe, expect, it, vi } from 'vitest'

import { pipelineEventBus } from './event-bus'

describe('pipelineEventBus', () => {
  it('delivers to type subscribers and wildcard, then stops after unsubscribe', () => {
    const seen: string[] = []
    const off = pipelineEventBus.subscribe('phase_start', (e) => seen.push(`t:${e.name}`))
    const offAll = pipelineEventBus.subscribeAll((e) => seen.push(`*:${e.type}`))
    pipelineEventBus.emit({ type: 'phase_start', runId: 'r', name: 'p' })
    off()
    pipelineEventBus.emit({ type: 'phase_start', runId: 'r', name: 'q' })
    offAll()
    expect(seen).toEqual(['t:p', '*:phase_start', '*:phase_start'])
  })

  it('isolates a throwing listener from siblings', () => {
    const sib = vi.fn()
    const off1 = pipelineEventBus.subscribe('run_start', () => {
      throw new Error('boom')
    })
    const off2 = pipelineEventBus.subscribe('run_start', sib)
    expect(() =>
      pipelineEventBus.emit({ type: 'run_start', runId: 'r', kind: 'k', actionId: 'a' }),
    ).not.toThrow()
    expect(sib).toHaveBeenCalledOnce()
    off1()
    off2()
  })
})
