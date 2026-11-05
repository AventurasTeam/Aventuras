// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { NativeScrollEvent } from 'react-native'
import type { SharedValue } from 'react-native-reanimated'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PinnedEndContext, useEndLockedScrollHandlers } from './sheet-list-lock'

type Context = { initialContentOffsetY?: number; shouldLockInitialPosition?: boolean }
type Handler = (event: NativeScrollEvent, context: Context) => void

// gorhom's scroll handler holds a locked list where the context says when it runs.
const seen = vi.hoisted(() => [] as Context[])
const defaults = vi.hoisted(() => ({
  handleOnScroll: (_event: unknown, context: Context) => {
    seen.push({ ...context })
  },
  handleOnBeginDrag: () => {},
  handleOnEndDrag: () => {},
  handleOnMomentumEnd: () => {},
}))
vi.mock('@gorhom/bottom-sheet', () => ({ useScrollEventsHandlersDefault: () => defaults }))

const EVENT = { contentOffset: { x: 0, y: 40 } } as NativeScrollEvent

function handlers(pinnedEnd: number | null) {
  const value = pinnedEnd == null ? null : ({ value: pinnedEnd } as SharedValue<number>)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PinnedEndContext.Provider value={value}>{children}</PinnedEndContext.Provider>
  )
  const ref = { current: null } as unknown as Parameters<typeof useEndLockedScrollHandlers>[0]
  const offset = { value: 0 } as SharedValue<number>
  return renderHook(() => useEndLockedScrollHandlers(ref, offset), { wrapper }).result
    .current as Record<string, Handler>
}

describe('useEndLockedScrollHandlers', () => {
  beforeEach(() => {
    seen.length = 0
  })

  it('holds a pinned list at its end before gorhom locks the scroll', () => {
    handlers(300).handleOnScroll(EVENT, {})

    expect(seen).toEqual([{ shouldLockInitialPosition: true, initialContentOffsetY: 300 }])
  })

  it("leaves gorhom's own hold once the list is unpinned, or outside a Sheet", () => {
    for (const pinnedEnd of [-1, null]) {
      seen.length = 0
      handlers(pinnedEnd).handleOnScroll(EVENT, {})

      expect(seen).toEqual([{}])
    }
  })

  it("keeps gorhom's drag and momentum handlers", () => {
    const { handleOnBeginDrag, handleOnEndDrag, handleOnMomentumEnd } = handlers(300)

    expect([handleOnBeginDrag, handleOnEndDrag, handleOnMomentumEnd]).toEqual([
      defaults.handleOnBeginDrag,
      defaults.handleOnEndDrag,
      defaults.handleOnMomentumEnd,
    ])
  })
})
