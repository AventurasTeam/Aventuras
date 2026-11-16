// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { useRef, type JSX } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { generationStore, type RunState } from '@/lib/stores'

import { useStoryLeaveGuard } from './use-story-leave-guard'
import { useUnsavedChangesGuard } from './use-unsaved-changes-guard'

type Prevented = (event: { data: { action: unknown } }) => void
type Route = { key: string; name: string }

// React Navigation's beforeRemove: every listener runs on one event, and a replayed action
// carries the route as visited, so it reaches no listener again (useOnPreventRemove.tsx).
const nav = vi.hoisted(() => ({
  listeners: new Map<object, { prevent: boolean; onPrevented: Prevented }>(),
  dispatch: vi.fn<(action: unknown) => void>(),
  routes: [] as { key: string; name: string }[],
}))

vi.mock('@react-navigation/native', async () => {
  const { useRef: useHookRef } = await import('react')
  return {
    useNavigation: () => ({ dispatch: nav.dispatch }),
    useIsFocused: () => true,
    useRoute: () => ({ key: 'reader' }),
    useNavigationState: (select: (state: { routes: Route[] }) => unknown) =>
      select({ routes: nav.routes }),
    usePreventRemove: (prevent: boolean, onPrevented: Prevented) => {
      const id = useHookRef({}).current
      nav.listeners.set(id, { prevent, onPrevented })
    },
  }
})

vi.mock('@/components/compounds/story-leave-dialog', () => ({ StoryLeaveDialog: () => null }))

const BACK = { type: 'GO_BACK' }

function pop(): void {
  const armed = [...nav.listeners.values()].filter((l) => l.prevent)
  if (armed.length === 0) {
    nav.dispatch(BACK)
    return
  }
  for (const listener of armed) listener.onPrevented({ data: { action: BACK } })
}

function inFlightRun(): RunState {
  return {
    runId: 'run_1',
    kind: 'per-turn',
    gateBehavior: 'hard-gate',
    actionId: 'act_1',
    storyId: 'story_1',
    branchId: 'br_1',
    abortController: new AbortController(),
    currentPhase: 'narrative',
    intermediates: {},
    terminal: new Promise<void>(() => {}),
    resolveTerminal: () => {},
    interruptible: null,
    beforeTurn: false,
  }
}

type Surface = {
  storyLeave: JSX.Element | null
  leaves: (() => void)[]
}

function ScreenGuards({ dirty, surface }: { dirty: boolean; surface: Surface }) {
  const leaves = useRef(surface.leaves)
  const { dialog } = useStoryLeaveGuard('story_1', 'br_1')
  useUnsavedChangesGuard(dirty, (proceed) => leaves.current.push(proceed))
  surface.storyLeave = dialog
  return null
}

beforeEach(() => {
  generationStore.__reset()
  nav.listeners.clear()
  nav.dispatch.mockReset()
  nav.routes = [
    { key: 'home', name: 'index' },
    { key: 'reader', name: 'reader-composer/[branchId]' },
  ]
})
afterEach(() => {
  cleanup()
})

describe('the unsaved guard and story-leave on one route', () => {
  it('asks the unsaved guard alone first when a pop leaves a busy story', () => {
    generationStore.startRun(inFlightRun())
    const surface: Surface = { storyLeave: null, leaves: [] }
    render(<ScreenGuards dirty surface={surface} />)

    act(() => pop())

    expect(surface.leaves).toHaveLength(1)
    expect(surface.storyLeave?.props.open).toBe(false)
    expect(nav.dispatch).not.toHaveBeenCalled()
  })

  it('raises story-leave after the unsaved guard proceeds, before the pop goes through', () => {
    generationStore.startRun(inFlightRun())
    const surface: Surface = { storyLeave: null, leaves: [] }
    const { rerender } = render(<ScreenGuards dirty surface={surface} />)
    act(() => pop())

    act(() => surface.leaves[0]())
    rerender(<ScreenGuards dirty={false} surface={surface} />)

    expect(surface.storyLeave?.props.open).toBe(true)
    expect(nav.dispatch).not.toHaveBeenCalled()
  })

  it('replays the pop once the unsaved guard proceeds on an idle story', () => {
    const surface: Surface = { storyLeave: null, leaves: [] }
    render(<ScreenGuards dirty surface={surface} />)
    act(() => pop())

    act(() => surface.leaves[0]())

    expect(nav.dispatch).toHaveBeenCalledWith(BACK)
  })

  it('leaves a clean surface to story-leave alone', () => {
    generationStore.startRun(inFlightRun())
    const surface: Surface = { storyLeave: null, leaves: [] }
    render(<ScreenGuards dirty={false} surface={surface} />)

    act(() => pop())

    expect(surface.leaves).toHaveLength(0)
    expect(surface.storyLeave?.props.open).toBe(true)
  })
})
