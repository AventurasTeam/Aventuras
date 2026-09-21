// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import type { ScrollView, View } from 'react-native'
import { describe, expect, it, vi } from 'vitest'

import { useRevealScroll, type RevealRequest } from './use-reveal-scroll'

const a11y = vi.hoisted(() => ({ sendAccessibilityEvent: vi.fn() }))

// This project resolves react-native to RN Web, so the native branch needs its platform pinned.
vi.mock('react-native', async (importOriginal) => {
  const rn = await importOriginal<{ Platform: object; AccessibilityInfo: object }>()
  return {
    ...rn,
    Platform: { ...rn.Platform, OS: 'android' },
    AccessibilityInfo: {
      ...rn.AccessibilityInfo,
      sendAccessibilityEvent: a11y.sendAccessibilityEvent,
    },
  }
})

describe('useRevealScroll on native', () => {
  it("scrolls to the revealed row and moves the screen reader's focus to it", async () => {
    const scrollTo = vi.fn()
    const { result, rerender } = renderHook(
      ({ reveal }: { reveal: RevealRequest | null }) => useRevealScroll(reveal, 'k'),
      { initialProps: { reveal: null as RevealRequest | null } },
    )
    result.current.contentRef.current = {} as View
    result.current.scrollRef.current = { scrollTo } as unknown as ScrollView
    const row = {
      measureLayout: (_content: View, onSuccess: (x: number, y: number) => void) =>
        onSuccess(0, 120),
    } as unknown as View
    const pressable = {} as View
    result.current.rowRef('r1')(row)
    result.current.focusRef('r1')(pressable)

    rerender({ reveal: { id: 'r1' } })

    await waitFor(() =>
      expect(a11y.sendAccessibilityEvent).toHaveBeenCalledWith(pressable, 'focus'),
    )
    expect(scrollTo).toHaveBeenCalledWith({ y: 120, animated: true })
  })
})
