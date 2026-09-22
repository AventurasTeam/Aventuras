// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PlotSelection } from './plot-selection'
import { usePlotDeepLink } from './use-plot-deep-link'

const LINK: PlotSelection = { kind: 'happening', id: 'h_1', tab: 'awareness' }

type Props = { link: PlotSelection | null; ready: boolean }

function setup(initial: Props) {
  const reveal = vi.fn<(link: PlotSelection) => void>()
  const hook = renderHook(({ link, ready }: Props) => usePlotDeepLink(link, ready, reveal), {
    initialProps: initial,
  })
  return { hook, reveal }
}

afterEach(cleanup)

describe('usePlotDeepLink', () => {
  it('holds the link and reveals nothing until the panes are ready', () => {
    const { hook, reveal } = setup({ link: LINK, ready: false })
    expect(hook.result.current).toBe(LINK)
    hook.rerender({ link: LINK, ready: false })
    expect(hook.result.current).toBe(LINK)
    expect(reveal).not.toHaveBeenCalled()
  })

  it('reveals once on the first ready commit, then stops handing out the link', () => {
    const { hook, reveal } = setup({ link: LINK, ready: false })
    hook.rerender({ link: LINK, ready: true })
    expect(reveal).toHaveBeenCalledTimes(1)
    expect(reveal).toHaveBeenCalledWith(LINK)
    expect(hook.result.current).toBeNull()

    hook.rerender({ link: LINK, ready: false })
    hook.rerender({ link: LINK, ready: true })
    expect(reveal).toHaveBeenCalledTimes(1)
    expect(hook.result.current).toBeNull()
  })

  it('hands the link to the render that first mounts the panes', () => {
    const reveal = vi.fn<(link: PlotSelection) => void>()
    const rendered: { ready: boolean; link: PlotSelection | null }[] = []
    const hook = renderHook(
      ({ ready }: { ready: boolean }) => {
        const link = usePlotDeepLink(LINK, ready, reveal)
        rendered.push({ ready, link })
        return link
      },
      { initialProps: { ready: false } },
    )
    hook.rerender({ ready: true })
    expect(rendered.find((r) => r.ready)?.link).toBe(LINK)
    expect(rendered.at(-1)).toEqual({ ready: true, link: null })
  })

  it('does nothing without a link', () => {
    const { hook, reveal } = setup({ link: null, ready: true })
    expect(hook.result.current).toBeNull()
    expect(reveal).not.toHaveBeenCalled()
  })
})
