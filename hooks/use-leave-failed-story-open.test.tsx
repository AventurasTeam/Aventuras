// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { toastStore, type ToastItem } from '@/lib/toast'

import { useLeaveFailedStoryOpen } from './use-leave-failed-story-open'

const router = vi.hoisted(() => ({ dismissTo: vi.fn<(href: string) => void>() }))
vi.mock('expo-router', () => ({ useRouter: () => router }))

let leave: (() => void) | null = null

function Probe() {
  leave = useLeaveFailedStoryOpen()
  return null
}

describe('useLeaveFailedStoryOpen', () => {
  let shown: ToastItem[] = []

  beforeEach(() => {
    router.dismissTo.mockReset()
    toastStore.__reset()
    toastStore.subscribe((items) => {
      shown = items
    })
    leave = null
  })

  afterEach(cleanup)

  // dismissTo, not replace: it pops to the list when it's in the stack and replaces the
  // failed screen only when it isn't (a cold mount), so no stale entry is left behind.
  it('returns to the story list and says why in an error toast', () => {
    render(<Probe />)
    expect(leave).not.toBeNull()
    leave?.()
    expect(router.dismissTo).toHaveBeenCalledExactlyOnceWith('/')
    expect(shown).toEqual([
      expect.objectContaining({ severity: 'error', message: "Couldn't open this story" }),
    ])
  })
})
