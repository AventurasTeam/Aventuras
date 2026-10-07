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
  it('forces a collapse when the first width is narrow', () => {
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

  it('changes nothing on a remount at the same width, so a manual expand survives it', () => {
    win.width = 850
    const first = render(<RailViewportWatcher />)
    readerRailStore.dispatchDisplay({ type: 'setCollapsed', collapsed: false })
    const expanded = readerRailStore.getDisplay()
    expect(expanded.forced).toBe(false)
    first.unmount()

    render(<RailViewportWatcher />)
    expect(readerRailStore.getDisplay()).toEqual(expanded)
  })
})
