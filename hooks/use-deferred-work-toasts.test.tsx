// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { __resetBus, PER_TURN_KIND, pipelineEventBus } from '@/lib/pipeline'
import { toastStore, type ToastItem } from '@/lib/toast'

import { useDeferredWorkToasts } from './use-deferred-work-toasts'

function Probe() {
  useDeferredWorkToasts()
  return null
}

function deferred(kind: string): void {
  pipelineEventBus.emit({ type: 'run_deferred', runId: `run-${kind}`, kind, branchId: 'branch-1' })
}

describe('useDeferredWorkToasts', () => {
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
    deferred(PERIODIC_CLASSIFIER_KIND)
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
    deferred('chapter-close')
    expect(shown).toEqual([
      expect.objectContaining({
        severity: 'info',
        message: 'Chapter close moved to your next turn.',
      }),
    ])
  })

  it('stays quiet for a kind that defers nothing', () => {
    render(<Probe />)
    deferred(PER_TURN_KIND)
    expect(shown).toEqual([])
  })

  it('stops toasting once unmounted', () => {
    const { unmount } = render(<Probe />)
    unmount()
    deferred(PERIODIC_CLASSIFIER_KIND)
    expect(shown).toEqual([])
  })
})
