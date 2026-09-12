// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppActionsMenu } from './app-actions-menu'
import type { AppActionsMenuPureProps } from './app-actions-menu-pure'

const captured = vi.hoisted(() => ({ props: null as AppActionsMenuPureProps | null }))
vi.mock('@/components/compounds/app-actions-menu-pure', () => ({
  AppActionsMenuPure: (p: AppActionsMenuPureProps) => {
    captured.props = p
    return null
  },
}))

const router = vi.hoisted(() => ({
  push: vi.fn<(href: string) => void>(),
}))
vi.mock('expo-router', () => ({ useRouter: () => router }))

const surfaceNavigate = vi.hoisted(() => vi.fn<(path: string) => void>())
vi.mock('@/hooks/use-surface-navigate', () => ({ useSurfaceNavigate: () => surfaceNavigate }))

// Stubbed: the real hook pulls in react-native's Flow source, which the unit bundler can't parse.
vi.mock('@/hooks/use-is-route-focused', () => ({ useIsRouteFocused: () => true }))

const STORY = { storyId: 'story_1', branchId: 'br_1', surface: 'world' as const }

beforeEach(() => {
  captured.props = null
  router.push.mockReset()
  surfaceNavigate.mockReset()
})
afterEach(cleanup)

const entry = (id: string) => captured.props?.goTo?.entries.find((e) => e.id === id)

describe('AppActionsMenu navigation', () => {
  it('GO TO navigates the surface; Diagnostics pushes', () => {
    render(<AppActionsMenu story={STORY} />)
    entry('open-reader')?.onActivate()
    expect(surfaceNavigate).toHaveBeenCalledWith('/reader-composer/br_1')
    expect(router.push).not.toHaveBeenCalled()
    captured.props?.onOpenDiagnosticsHub()
    expect(router.push).toHaveBeenCalledWith('/diagnostics')
  })

  it('routes both through beforeNavigate, and only proceeds when it calls proceed', () => {
    const held: (() => void)[] = []
    const beforeNavigate = vi.fn((proceed: () => void) => {
      held.push(proceed)
    })
    render(<AppActionsMenu story={STORY} beforeNavigate={beforeNavigate} />)
    entry('open-reader')?.onActivate()
    captured.props?.onOpenDiagnosticsHub()
    expect(beforeNavigate).toHaveBeenCalledTimes(2)
    expect(surfaceNavigate).not.toHaveBeenCalled()
    expect(router.push).not.toHaveBeenCalled()
    held.forEach((p) => p())
    expect(surfaceNavigate).toHaveBeenCalledWith('/reader-composer/br_1')
    expect(router.push).toHaveBeenCalledWith('/diagnostics')
  })

  it('omits GO TO off-story', () => {
    render(<AppActionsMenu />)
    expect(captured.props).not.toBeNull()
    expect(captured.props?.goTo).toBeUndefined()
  })
})
