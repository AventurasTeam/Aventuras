// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { blockingOverlaysStore, useRegisteredOverlay } from '@/lib/stores'

afterEach(() => {
  cleanup()
  blockingOverlaysStore.__reset()
})

function Sheet({ open }: { open: boolean }) {
  useRegisteredOverlay(open)
  return null
}

const count = () => blockingOverlaysStore.getState().open.size

describe('useRegisteredOverlay', () => {
  it('registers nothing while closed, though the sheet is mounted', () => {
    render(<Sheet open={false} />)
    // The primitives stay mounted and drive presentation from `open`, so a
    // mount-scoped effect here would report every sheet on screen as open.
    expect(count()).toBe(0)
  })

  it('registers while open and releases when it closes', () => {
    const { rerender } = render(<Sheet open />)
    expect(count()).toBe(1)
    rerender(<Sheet open={false} />)
    expect(count()).toBe(0)
  })

  it('releases on unmount, so a sheet torn down while open does not stick', () => {
    const { unmount } = render(<Sheet open />)
    expect(count()).toBe(1)
    unmount()
    expect(count()).toBe(0)
  })

  it('counts concurrent sheets separately', () => {
    render(
      <>
        <Sheet open />
        <Sheet open />
      </>,
    )
    expect(count()).toBe(2)
  })

  it('nets back to one registration after the sheet is toggled shut and reopened', () => {
    const { rerender } = render(<Sheet open />)
    rerender(<Sheet open={false} />)
    rerender(<Sheet open />)
    // A release that missed its token would leave the first pass stranded here.
    expect(count()).toBe(1)
  })
})
