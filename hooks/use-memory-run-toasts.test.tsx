// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { __resetBus, PER_TURN_KIND, pipelineEventBus } from '@/lib/pipeline'
import { type DeferredWorkKind } from '@/lib/stores'
import { toastStore, type ToastItem } from '@/lib/toast'

import { useMemoryRunToasts } from './use-memory-run-toasts'

function Probe() {
  useMemoryRunToasts()
  return null
}

function deferred(work: DeferredWorkKind, kind: string): void {
  pipelineEventBus.emit({
    type: 'run_deferred',
    runId: `run-${kind}`,
    kind,
    branchId: 'branch-1',
    work,
  })
}

function ended(
  outcome: 'completed' | 'aborted' | 'failed',
  over: { kind?: string; beforeTurn?: boolean } = {},
): void {
  pipelineEventBus.emit({
    type: 'run_complete',
    runId: 'run-pass',
    kind: over.kind ?? PERIODIC_CLASSIFIER_KIND,
    actionId: 'act-pass',
    beforeTurn: over.beforeTurn ?? false,
    outcome,
    ...(outcome === 'failed'
      ? { error: { kind: 'provider', reason: 'timeout', detail: 'classifier: timeout' } as const }
      : {}),
  })
}

describe('useMemoryRunToasts', () => {
  let shown: ToastItem[] = []

  beforeEach(() => {
    __resetBus()
    toastStore.__reset()
    toastStore.subscribe((items) => {
      shown = items
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('toasts a deferred pass once, as info with no action', () => {
    render(<Probe />)
    deferred('pass', PERIODIC_CLASSIFIER_KIND)
    expect(shown).toEqual([
      expect.objectContaining({
        severity: 'info',
        message: 'Memory update moved to your next turn.',
      }),
    ])
    expect(shown[0]).not.toHaveProperty('action')
  })

  it('toasts a deferred chapter close with its own copy', () => {
    render(<Probe />)
    deferred('close', 'chapter-close')
    expect(shown).toEqual([
      expect.objectContaining({
        severity: 'info',
        message: 'Chapter close moved to your next turn.',
      }),
    ])
  })

  it('picks the copy from the deferred slot, not the run kind', () => {
    render(<Probe />)
    deferred('close', PERIODIC_CLASSIFIER_KIND)
    expect(shown).toEqual([
      expect.objectContaining({ message: 'Chapter close moved to your next turn.' }),
    ])
  })

  it('warns once when a pass outside a Send fails, with no action', () => {
    render(<Probe />)
    ended('failed')
    expect(shown).toEqual([
      expect.objectContaining({
        severity: 'warning',
        message: 'Memory update failed. It runs again before your next turn.',
      }),
    ])
    expect(shown[0]).not.toHaveProperty('action')
  })

  // A pass that fails at Send fails the Send, which the reader's system entry reports.
  it('stays quiet for a pass that fails before a turn', () => {
    render(<Probe />)
    ended('failed', { beforeTurn: true })
    expect(shown).toEqual([])
  })

  it('stays quiet for a pass that commits or is cancelled', () => {
    render(<Probe />)
    ended('completed')
    ended('aborted')
    expect(shown).toEqual([])
  })

  it("stays quiet for another kind's failure", () => {
    render(<Probe />)
    ended('failed', { kind: PER_TURN_KIND })
    expect(shown).toEqual([])
  })

  it('stops toasting once unmounted', () => {
    const { unmount } = render(<Probe />)
    unmount()
    deferred('pass', PERIODIC_CLASSIFIER_KIND)
    ended('failed')
    expect(shown).toEqual([])
  })
})
