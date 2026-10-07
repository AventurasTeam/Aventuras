// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readerRailStore } from '@/lib/stores'

import { RailViewportWatcher } from './rail-viewport-watcher'

const win = vi.hoisted(() => ({ width: 1200 }))

vi.mock('react-native', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useWindowDimensions: () => ({ width: win.width, height: 800, scale: 1, fontScale: 1 }),
}))

beforeEach(() => {
  readerRailStore.__reset()
  win.width = 1200
})

afterEach(() => {
  cleanup()
})

describe('RailViewportWatcher', () => {
  it('seeds the display from the first width, so a narrow window starts forced-collapsed', () => {
    win.width = 850
    render(<RailViewportWatcher />)
    expect(readerRailStore.getDisplay()).toMatchObject({ forced: true, lastWidth: 850 })
  })

  it('feeds every width change to the display reducer', () => {
    const { rerender } = render(<RailViewportWatcher />)
    expect(readerRailStore.getDisplay()).toMatchObject({ forced: false, lastWidth: 1200 })

    win.width = 850
    rerender(<RailViewportWatcher />)
    expect(readerRailStore.getDisplay()).toMatchObject({ forced: true, lastWidth: 850 })

    win.width = 1000
    rerender(<RailViewportWatcher />)
    expect(readerRailStore.getDisplay()).toMatchObject({ forced: false, lastWidth: 1000 })
  })

  it('does not reseed on a remount, so a manual expand in a narrow window survives it', () => {
    win.width = 850
    const first = render(<RailViewportWatcher />)
    readerRailStore.dispatchDisplay({ type: 'setCollapsed', collapsed: false })
    first.unmount()

    render(<RailViewportWatcher />)
    expect(readerRailStore.getDisplay().forced).toBe(false)
  })
})
