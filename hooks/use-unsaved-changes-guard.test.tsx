// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useUnsavedChangesGuard } from './use-unsaved-changes-guard'

type Listener = () => void

function stubBridge() {
  const listeners = new Set<Listener>()
  const bridge = {
    platform: 'linux' as NodeJS.Platform,
    revealDbFile: vi.fn(() => Promise.resolve()),
    setCloseGuard: vi.fn(),
    confirmClose: vi.fn(),
    onCloseRequested: vi.fn((cb: Listener) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }),
  }
  window.native = bridge
  return {
    ...bridge,
    requestClose: () => listeners.forEach((cb) => cb()),
    get armed() {
      const calls = bridge.setCloseGuard.mock.calls
      return calls.length > 0 ? calls[calls.length - 1][0] : undefined
    },
  }
}

function Guard({ dirty, requestLeave }: { dirty: boolean; requestLeave: (p: () => void) => void }) {
  useUnsavedChangesGuard(dirty, requestLeave)
  return null
}

afterEach(() => {
  cleanup()
  delete window.native
  vi.restoreAllMocks()
})

describe('useUnsavedChangesGuard', () => {
  it('arms the window guard only while a surface is dirty', () => {
    const bridge = stubBridge()
    const view = render(<Guard dirty={false} requestLeave={vi.fn()} />)
    expect(bridge.armed).toBe(false)

    view.rerender(<Guard dirty requestLeave={vi.fn()} />)
    expect(bridge.armed).toBe(true)

    view.rerender(<Guard dirty={false} requestLeave={vi.fn()} />)
    expect(bridge.armed).toBe(false)
  })

  // expo-router keeps a pushed-under screen mounted, so two surfaces can hold
  // the guard at once. `setCloseGuard` is one boolean per window, so a clean
  // second surface used to disarm a first that still had unsaved work.
  it('stays armed while another surface is still dirty', () => {
    const bridge = stubBridge()
    const view = render(
      <>
        <Guard dirty requestLeave={vi.fn()} />
        <Guard dirty requestLeave={vi.fn()} />
      </>,
    )
    expect(bridge.armed).toBe(true)

    view.rerender(
      <>
        <Guard dirty requestLeave={vi.fn()} />
        <Guard dirty={false} requestLeave={vi.fn()} />
      </>,
    )
    expect(bridge.armed).toBe(true)
  })

  it('asks every dirty surface before confirming the close', () => {
    const bridge = stubBridge()
    const first = vi.fn((proceed: () => void) => proceed())
    const second = vi.fn((proceed: () => void) => proceed())
    render(
      <>
        <Guard dirty requestLeave={first} />
        <Guard dirty requestLeave={second} />
      </>,
    )

    bridge.requestClose()

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(bridge.confirmClose).toHaveBeenCalledTimes(1)
  })

  it('leaves the window open when a surface cancels', () => {
    const bridge = stubBridge()
    const cancels = vi.fn(() => {})
    const later = vi.fn((proceed: () => void) => proceed())
    render(
      <>
        <Guard dirty requestLeave={cancels} />
        <Guard dirty requestLeave={later} />
      </>,
    )

    bridge.requestClose()

    expect(cancels).toHaveBeenCalledTimes(1)
    expect(later).not.toHaveBeenCalled()
    expect(bridge.confirmClose).not.toHaveBeenCalled()
    expect(bridge.armed).toBe(true)
  })

  it('falls back to beforeunload when no desktop bridge is present', () => {
    const add = vi.spyOn(window, 'addEventListener')
    render(<Guard dirty requestLeave={vi.fn()} />)

    expect(add).toHaveBeenCalledWith('beforeunload', expect.any(Function))
  })
})
