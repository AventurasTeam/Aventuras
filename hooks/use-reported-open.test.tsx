// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useReportedOpen } from './use-reported-open'

afterEach(cleanup)

function setup() {
  const onOpenChange = vi.fn<(open: boolean) => void>()
  const hook = renderHook(({ report }) => useReportedOpen(report), {
    initialProps: { report: onOpenChange as ((open: boolean) => void) | undefined },
  })
  const change = (next: boolean) => act(() => hook.result.current[1](next))
  return { onOpenChange, hook, change }
}

describe('useReportedOpen', () => {
  it('starts closed and reports an open and a close', () => {
    const { onOpenChange, hook, change } = setup()
    expect(hook.result.current[0]).toBe(false)
    change(true)
    expect(hook.result.current[0]).toBe(true)
    change(false)
    expect(hook.result.current[0]).toBe(false)
    expect(onOpenChange.mock.calls).toEqual([[true], [false]])
  })

  it('reports nothing for a close of a closed overlay, or an open of an open one', () => {
    const { onOpenChange, change } = setup()
    // A Popover's TriggerRef.close() reports a close while it is already closed.
    change(false)
    expect(onOpenChange).not.toHaveBeenCalled()
    change(true)
    change(true)
    expect(onOpenChange.mock.calls).toEqual([[true]])
  })

  it('reports a close when it unmounts open, as a tier flip swaps the arms', () => {
    const { onOpenChange, hook, change } = setup()
    change(true)
    hook.unmount()
    expect(onOpenChange.mock.calls).toEqual([[true], [false]])
  })

  it('reports nothing when it unmounts closed', () => {
    const { onOpenChange, hook, change } = setup()
    change(true)
    change(false)
    hook.unmount()
    expect(onOpenChange.mock.calls).toEqual([[true], [false]])
  })

  it('reports the unmount close to the latest callback', () => {
    const { onOpenChange, hook, change } = setup()
    change(true)
    const later = vi.fn<(open: boolean) => void>()
    hook.rerender({ report: later })
    hook.unmount()
    expect(onOpenChange.mock.calls).toEqual([[true]])
    expect(later.mock.calls).toEqual([[false]])
  })

  it('tracks the state with no callback', () => {
    const { result } = renderHook(() => useReportedOpen(undefined))
    act(() => result.current[1](true))
    expect(result.current[0]).toBe(true)
  })
})
