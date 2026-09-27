// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { useWorldDeepLink } from './use-world-deep-link'
import type { WorldSelection } from './world-selection'

const LINK: WorldSelection = { category: 'character', id: 'char_kael', tab: 'connections' }

type Props = { link: WorldSelection | null; ready: boolean }

function setup(initial: Props) {
  return renderHook(({ link, ready }: Props) => useWorldDeepLink(link, ready), {
    initialProps: initial,
  })
}

afterEach(cleanup)

describe('useWorldDeepLink', () => {
  it('holds the link until the panes are ready', () => {
    const hook = setup({ link: LINK, ready: false })
    expect(hook.result.current).toBe(LINK)
    hook.rerender({ link: LINK, ready: false })
    expect(hook.result.current).toBe(LINK)
  })

  it('stops handing out the link after the first ready commit, for good', () => {
    const hook = setup({ link: LINK, ready: false })
    hook.rerender({ link: LINK, ready: true })
    expect(hook.result.current).toBeNull()

    hook.rerender({ link: LINK, ready: false })
    hook.rerender({ link: LINK, ready: true })
    expect(hook.result.current).toBeNull()
  })

  it('hands the link to the render that first mounts the panes', () => {
    const rendered: { ready: boolean; link: WorldSelection | null }[] = []
    const hook = renderHook(
      ({ ready }: { ready: boolean }) => {
        const link = useWorldDeepLink(LINK, ready)
        rendered.push({ ready, link })
        return link
      },
      { initialProps: { ready: false } },
    )
    hook.rerender({ ready: true })
    expect(rendered.find((r) => r.ready)?.link).toBe(LINK)
    expect(rendered.at(-1)).toEqual({ ready: true, link: null })
  })

  it('hands the link to a first render that is already ready, then drops it', () => {
    const rendered: (WorldSelection | null)[] = []
    renderHook(() => {
      const link = useWorldDeepLink(LINK, true)
      rendered.push(link)
      return link
    })
    expect(rendered[0]).toBe(LINK)
    expect(rendered.at(-1)).toBeNull()
  })

  it('does nothing without a link', () => {
    const hook = setup({ link: null, ready: true })
    expect(hook.result.current).toBeNull()
  })
})
