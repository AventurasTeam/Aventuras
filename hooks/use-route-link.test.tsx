// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useRouteLink } from './use-route-link'

type Link = { id: string; tab?: string }

const LINK: Link = { id: 'h_1', tab: 'awareness' }
const NEXT: Link = { id: 'h_2', tab: 'involvements' }

type Props = { link: Link | null; ready: boolean }

function setup(initial: Props) {
  const arrive = vi.fn<(link: Link, atMount: boolean) => void>()
  const hook = renderHook(({ link, ready }: Props) => useRouteLink(link, ready, arrive), {
    initialProps: initial,
  })
  return { hook, arrive }
}

afterEach(cleanup)

describe('useRouteLink', () => {
  it('holds the link and hands it to no one until the panes are ready', () => {
    const { hook, arrive } = setup({ link: LINK, ready: false })
    expect(hook.result.current).toBe(LINK)
    hook.rerender({ link: LINK, ready: false })
    expect(hook.result.current).toBe(LINK)
    expect(arrive).not.toHaveBeenCalled()
  })

  it('handles the mount link once on the first ready commit, then stops handing it out', () => {
    const { hook, arrive } = setup({ link: LINK, ready: false })
    hook.rerender({ link: LINK, ready: true })
    expect(arrive).toHaveBeenCalledTimes(1)
    expect(arrive).toHaveBeenCalledWith(LINK, true)
    expect(hook.result.current).toBeNull()

    hook.rerender({ link: LINK, ready: false })
    hook.rerender({ link: LINK, ready: true })
    expect(arrive).toHaveBeenCalledTimes(1)
    expect(hook.result.current).toBeNull()
  })

  it('hands the mount link to the render that first mounts the panes', () => {
    const rendered: { ready: boolean; link: Link | null }[] = []
    const hook = renderHook(
      ({ ready }: { ready: boolean }) => {
        const link = useRouteLink(LINK, ready, () => {})
        rendered.push({ ready, link })
        return link
      },
      { initialProps: { ready: false } },
    )
    hook.rerender({ ready: true })
    expect(rendered.find((r) => r.ready)?.link).toBe(LINK)
    expect(rendered.at(-1)).toEqual({ ready: true, link: null })
  })

  it('follows a link that arrives on the mounted screen, and hands it to the render after', () => {
    const log: string[] = []
    const hook = renderHook(
      ({ link }: { link: Link }) => {
        const handed = useRouteLink(link, true, (arrived, atMount) =>
          log.push(`arrive ${arrived.id} ${atMount}`),
        )
        log.push(`render ${handed?.id ?? '-'}`)
        return handed
      },
      { initialProps: { link: LINK } },
    )
    log.length = 0
    hook.rerender({ link: NEXT })
    const arrived = log.indexOf('arrive h_2 false')
    expect(arrived).toBeGreaterThan(-1)
    // `arrive` applies the selection; the pane for it mounts on the render after.
    expect(log[arrived + 1]).toBe('render h_2')
    expect(hook.result.current).toBeNull()
  })

  it('follows a link that equals one already handled only when it changes again', () => {
    const { hook, arrive } = setup({ link: LINK, ready: true })
    hook.rerender({ link: { ...LINK }, ready: true })
    expect(arrive).toHaveBeenCalledTimes(1)
    hook.rerender({ link: NEXT, ready: true })
    hook.rerender({ link: LINK, ready: true })
    expect(arrive).toHaveBeenLastCalledWith(LINK, false)
    expect(arrive).toHaveBeenCalledTimes(3)
  })

  it('does nothing without a link', () => {
    const { hook, arrive } = setup({ link: null, ready: true })
    expect(hook.result.current).toBeNull()
    expect(arrive).not.toHaveBeenCalled()
  })
})
