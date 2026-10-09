// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { APP_SETTINGS_DEFAULTS } from '@/lib/db'
import { appSettingsStore, hydrateAppSettings, readerRailStore } from '@/lib/stores'

import { useOpenRailPeek, useRailPeek } from './use-rail-peek'

const MIRA = { category: 'character', id: 'char_mira' } as const

// The settings store re-hydrating from the row, as a preference write or a settings import does.
async function storeRailPreference(collapsed: boolean): Promise<void> {
  const result = await hydrateAppSettings(async () => ({
    ...APP_SETTINGS_DEFAULTS,
    appearance: { ...APP_SETTINGS_DEFAULTS.appearance, readerRailCollapsed: collapsed },
  }))
  expect(result).toEqual({ status: 'ok' })
}

beforeEach(async () => {
  readerRailStore.__reset()
  appSettingsStore.__reset()
  await storeRailPreference(false)
})

afterEach(() => {
  cleanup()
})

describe('useRailPeek', () => {
  it('opens a peek while the rail shows expanded', () => {
    const { result } = renderHook(() => useRailPeek())
    expect(result.current.peek).toBeNull()

    act(() => result.current.openPeek('character', 'char_mira'))

    expect(result.current.peek).toEqual(MIRA)
    expect(readerRailStore.getDisplay().peek).toEqual(MIRA)
  })

  it('ignores an open while the stored preference is collapsed', async () => {
    const { result } = renderHook(() => useRailPeek())
    await act(async () => {
      await storeRailPreference(true)
    })

    act(() => result.current.openPeek('character', 'char_mira'))

    expect(result.current.peek).toBeNull()
    expect(readerRailStore.getDisplay().peek).toBeNull()
  })

  it('ignores an open while the viewport forces a collapse', () => {
    readerRailStore.dispatchDisplay({ type: 'resize', width: 1200 })
    readerRailStore.dispatchDisplay({ type: 'resize', width: 800 })
    const { result } = renderHook(() => useRailPeek())

    act(() => result.current.openPeek('character', 'char_mira'))

    expect(result.current.peek).toBeNull()
  })

  it('opens under a pending expand while the stored preference still says collapsed', async () => {
    await storeRailPreference(true)
    readerRailStore.dispatchDisplay({ type: 'setCollapsed', collapsed: false })
    const { result } = renderHook(() => useRailPeek())

    act(() => result.current.openPeek('character', 'char_mira'))

    expect(result.current.peek).toEqual(MIRA)
  })

  it('clears an open peek on closePeek', () => {
    const { result } = renderHook(() => useRailPeek())
    act(() => result.current.openPeek('character', 'char_mira'))

    act(() => result.current.closePeek())

    expect(result.current.peek).toBeNull()
  })

  it('clears an open peek when the rail collapses', async () => {
    const { result } = renderHook(() => useRailPeek())
    act(() => result.current.openPeek('character', 'char_mira'))

    await act(async () => {
      await readerRailStore.writeCollapsed(true, async () => {})
    })

    expect(result.current.peek).toBeNull()
  })
})

describe('useOpenRailPeek', () => {
  it("doesn't re-render its caller when a peek opens and closes", () => {
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      return useOpenRailPeek()
    })
    const rendersBefore = renders

    act(() => result.current('character', 'char_mira'))
    expect(readerRailStore.getDisplay().peek).toEqual(MIRA)
    act(() => readerRailStore.dispatchDisplay({ type: 'closePeek' }))
    expect(readerRailStore.getDisplay().peek).toBeNull()

    expect(renders).toBe(rendersBefore)
  })
})
