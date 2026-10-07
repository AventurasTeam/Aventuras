// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ThemeProvider } from '@/lib/themes'

import { useSheetDismissal } from './sheet'

// Stubbed: each ships Flow, JSX or a native lookup the unit bundler can't load, and the hook
// touches none of them.
vi.mock('@gorhom/bottom-sheet', () => ({}))
vi.mock('@rn-primitives/dialog', () => ({}))
vi.mock('@rn-primitives/slot', () => ({}))
vi.mock('react-native-keyboard-controller', () => ({}))
vi.mock('react-native-reanimated', () => ({}))
vi.mock('react-native-safe-area-context', () => ({}))
vi.mock('react-native-screens', () => ({}))

// The sheet stories' plays pin the scrim half; no web story drags, so drag-down is pinned here.

const wrapper = ({ children }: { children: ReactNode }) => <ThemeProvider>{children}</ThemeProvider>

afterEach(cleanup)

describe('useSheetDismissal', () => {
  it('turns drag-down off for a sheet that must stay open', () => {
    const { result } = renderHook(() => useSheetDismissal(false), { wrapper })
    expect(result.current.enablePanDownToClose).toBe(false)
  })

  it('turns drag-down on for a dismissible sheet', () => {
    const { result } = renderHook(() => useSheetDismissal(true), { wrapper })
    expect(result.current.enablePanDownToClose).toBe(true)
  })

  it('follows a flip while mounted', () => {
    const { result, rerender } = renderHook(
      ({ dismissible }: { dismissible: boolean }) => useSheetDismissal(dismissible),
      { wrapper, initialProps: { dismissible: true } },
    )
    rerender({ dismissible: false })
    expect(result.current.enablePanDownToClose).toBe(false)
    rerender({ dismissible: true })
    expect(result.current.enablePanDownToClose).toBe(true)
  })
})
