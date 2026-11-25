// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@/lib/toast'

import { useDuplicateDoneToast } from './use-duplicate-done-toast'

vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), dismiss: vi.fn() } }))

// The locale's lines, written out: reading them through t() would pass on any string.
const DONE = 'Duplicated as "Ashes of Aria"'
const OPEN = 'Open'
const COPIED = { storyId: 'story_copy', title: 'Ashes of Aria' }

let shown = 0
beforeEach(() => {
  shown = 0
  vi.mocked(toast.success).mockReset()
  vi.mocked(toast.success).mockImplementation(() => `toast-${++shown}`)
  vi.mocked(toast.dismiss).mockReset()
})
afterEach(() => {
  cleanup()
})

type Props = { focused: boolean; blocked: boolean }

function setup(focused = true) {
  const open = vi.fn<(storyId: string) => void>()
  const hook = renderHook((props: Props) => useDuplicateDoneToast({ ...props, open }), {
    initialProps: { focused, blocked: false },
  })
  return { ...hook, open }
}

function pressOpen(call = 0) {
  const action = vi.mocked(toast.success).mock.calls[call]?.[1]?.action
  if (action == null) throw new Error(`toast ${call} carries no action`)
  act(() => {
    action.onPress()
  })
}

describe('useDuplicateDoneToast', () => {
  it('shows the success toast with an Open action', () => {
    const { result } = setup()
    act(() => {
      result.current(COPIED)
    })
    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith(DONE, {
      action: { label: OPEN, onPress: expect.any(Function) },
    })
  })

  it('opens the copy when Open is pressed on the focused list', () => {
    const { result, open } = setup()
    act(() => {
      result.current(COPIED)
    })
    pressOpen()
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('story_copy')
  })

  it('opens nothing when Open is pressed once the list lost focus', () => {
    const { result, rerender, open } = setup()
    act(() => {
      result.current(COPIED)
    })
    rerender({ focused: false, blocked: false })
    pressOpen()
    expect(open).not.toHaveBeenCalled()
  })

  it('opens nothing when Open is pressed while a list confirm is up', () => {
    const { result, rerender, open } = setup()
    act(() => {
      result.current(COPIED)
    })
    rerender({ focused: true, blocked: true })
    pressOpen()
    expect(open).not.toHaveBeenCalled()
  })

  it('dismisses the toast by its id when the list loses focus', () => {
    const { result, rerender } = setup()
    act(() => {
      result.current(COPIED)
    })
    expect(toast.dismiss).not.toHaveBeenCalled()
    rerender({ focused: false, blocked: false })
    expect(toast.dismiss).toHaveBeenCalledTimes(1)
    expect(toast.dismiss).toHaveBeenCalledWith('toast-1')
  })

  it('dismisses the toast when the list unmounts', () => {
    const { result, unmount } = setup()
    act(() => {
      result.current(COPIED)
    })
    unmount()
    expect(toast.dismiss).toHaveBeenCalledWith('toast-1')
  })

  it('shows nothing for a copy that lands after the list unmounts', () => {
    const { result, unmount } = setup()
    const show = result.current
    unmount()
    show(COPIED)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("opens nothing when a kept toast's Open is pressed after the list unmounts", () => {
    const { result, unmount, open } = setup()
    act(() => {
      result.current(COPIED)
    })
    unmount()
    pressOpen()
    expect(open).not.toHaveBeenCalled()
  })

  it('shows the toast and opens the copy under StrictMode', () => {
    const open = vi.fn<(storyId: string) => void>()
    const { result } = renderHook(
      () => useDuplicateDoneToast({ focused: true, blocked: false, open }),
      { wrapper: StrictMode },
    )
    act(() => {
      result.current(COPIED)
    })
    expect(toast.success).toHaveBeenCalledTimes(1)
    pressOpen()
    expect(open).toHaveBeenCalledWith('story_copy')
  })

  it('replaces an earlier done toast with the newer one', () => {
    const { result, rerender } = setup()
    act(() => {
      result.current(COPIED)
    })
    act(() => {
      result.current({ storyId: 'story_copy_2', title: 'Second' })
    })
    expect(toast.dismiss).toHaveBeenCalledWith('toast-1')
    expect(toast.success).toHaveBeenLastCalledWith('Duplicated as "Second"', expect.anything())
    rerender({ focused: false, blocked: false })
    expect(toast.dismiss).toHaveBeenLastCalledWith('toast-2')
  })

  it('shows nothing for a copy that lands while the list is unfocused', () => {
    const { result } = setup(false)
    act(() => {
      result.current(COPIED)
    })
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('dismisses nothing when it never showed a toast', () => {
    const { rerender, unmount } = setup()
    rerender({ focused: false, blocked: false })
    unmount()
    expect(toast.dismiss).not.toHaveBeenCalled()
  })
})
