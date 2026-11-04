import { describe, expect, it, vi } from 'vitest'

import { routeJumpToBottom } from './jump-to-bottom'

// Expo's DOM ref proxy: an unregistered method reads as undefined, a registered one injects.
function documentProxy(registered: boolean, inject: () => void) {
  return new Proxy({} as { jumpToBottom: () => void }, {
    get: (_, prop) => (registered && prop === 'jumpToBottom' ? inject : undefined),
  })
}

describe('routeJumpToBottom', () => {
  it('jumps the surface on web, whatever the document reports', () => {
    const surface = { jumpToBottom: vi.fn() }
    const inject = vi.fn()

    routeJumpToBottom('web', surface, documentProxy(true, inject), false)

    expect(surface.jumpToBottom).toHaveBeenCalledOnce()
    expect(inject).not.toHaveBeenCalled()
  })

  it('does nothing on native before the document paints, with its handle unregistered', () => {
    const inject = vi.fn()

    expect(() =>
      routeJumpToBottom('android', null, documentProxy(false, inject), false),
    ).not.toThrow()
    expect(inject).not.toHaveBeenCalled()
  })

  it('jumps the document on native once it has painted', () => {
    const inject = vi.fn()

    routeJumpToBottom('android', null, documentProxy(true, inject), true)

    expect(inject).toHaveBeenCalledOnce()
  })
})
