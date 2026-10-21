// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { __resetBus, pipelineEventBus } from '@/lib/pipeline'
import { type DeferredWorkKind } from '@/lib/stores'
import { toastStore, type ToastItem } from '@/lib/toast'

import { useDeferredWorkToasts } from './use-deferred-work-toasts'

function Probe() {
  useDeferredWorkToasts()
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

  it('stops toasting once unmounted', () => {
    const { unmount } = render(<Probe />)
    unmount()
    deferred('pass', PERIODIC_CLASSIFIER_KIND)
    expect(shown).toEqual([])
  })
})
