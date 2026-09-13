// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import type { ScrollView, View } from 'react-native'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useRevealScroll, type RevealRequest } from './use-reveal-scroll'

afterEach(() => {
  document.body.replaceChildren()
})

function button(): HTMLButtonElement {
  const el = document.createElement('button')
  document.body.append(el)
  return el
}

// A reveal lands only once its accordion settles and measureLayout calls back, so the row's
// callback is held: each test decides what happens between the reveal starting and landing.
function revealHarness() {
  const { result, rerender } = renderHook(
    ({ reveal }: { reveal: RevealRequest | null }) => useRevealScroll(reveal, 'k'),
    { initialProps: { reveal: null as RevealRequest | null } },
  )
  let pending: (() => void) | null = null
  result.current.contentRef.current = {} as View
  result.current.scrollRef.current = { scrollTo: vi.fn() } as unknown as ScrollView
  const row = {
    measureLayout: (_content: View, onSuccess: (x: number, y: number) => void) => {
      pending = () => onSuccess(0, 120)
    },
  } as unknown as View
  const pressable = button()
  result.current.rowRef('r1')(row)
  result.current.focusRef('r1')(pressable as unknown as View)
  return {
    pressable,
    start: () => rerender({ reveal: { id: 'r1' } }),
    land: async () => {
      await vi.waitFor(() => expect(pending).not.toBeNull())
      pending?.()
    },
  }
}

describe('useRevealScroll on web', () => {
  it('moves keyboard focus to the revealed row when it lands', async () => {
    const { pressable, start, land } = revealHarness()
    button().focus()

    start()
    await land()

    expect(document.activeElement).toBe(pressable)
  })

  it('still lands when the control that asked for it unmounted meanwhile', async () => {
    const { pressable, start, land } = revealHarness()
    const badge = button()
    badge.focus()

    start()
    badge.remove()
    await land()

    expect(document.activeElement).toBe(pressable)
  })

  it('leaves focus with a surface that took it before the reveal landed', async () => {
    const { start, land } = revealHarness()
    button().focus()

    start()
    const search = document.createElement('input')
    document.body.append(search)
    search.focus()
    await land()

    expect(document.activeElement).toBe(search)
  })
})
