// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@/lib/diagnostics'
import { generationStore, type RunState } from '@/lib/stores'

import { useStoryLeaveGuard } from './use-story-leave-guard'

type Route = { key: string; name: string }
type Prevented = (event: { data: { action: unknown } }) => void
type CancelStoryRuns = (storyId: string, branchId: string) => Promise<void>

const nav = vi.hoisted(() => ({
  preventRemove: false,
  onPrevented: null as null | ((event: { data: { action: unknown } }) => void),
  dispatch: vi.fn<(action: unknown) => void>(),
  focused: true,
  routes: [] as { key: string; name: string }[],
  routeKey: '',
}))
const cancelStoryRuns = vi.hoisted(() =>
  vi.fn<(storyId: string, branchId: string) => Promise<void>>(),
)

vi.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ dispatch: nav.dispatch }),
  useIsFocused: () => nav.focused,
  useRoute: () => ({ key: nav.routeKey }),
  useNavigationState: (select: (state: { routes: Route[] }) => unknown) =>
    select({ routes: nav.routes }),
  usePreventRemove: (prevent: boolean, onPrevented: Prevented) => {
    nav.preventRemove = prevent
    nav.onPrevented = onPrevented
  },
}))

// The real dialog renders rn-primitives chrome the unit project can't load; its props are
// what the hook decides.
vi.mock('@/components/compounds/story-leave-dialog', () => ({ StoryLeaveDialog: () => null }))

vi.mock('@/lib/stores', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  cancelStoryRuns,
}))

// The real cancel, for the case whose subject is its wait on a reversal.
let realCancelStoryRuns: CancelStoryRuns
beforeAll(async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/stores')
  realCancelStoryRuns = actual.cancelStoryRuns as CancelStoryRuns
})

const HOME: Route = { key: 'home', name: 'index' }
const READER: Route = { key: 'reader', name: 'reader-composer/[branchId]' }
const WORLD: Route = { key: 'world', name: 'world/[branchId]' }
const BACK = { type: 'GO_BACK' }

function inFlightRun(storyId: string, branchId = 'br_1'): RunState {
  return {
    runId: `run_${storyId}`,
    kind: 'per-turn',
    gateBehavior: 'hard-gate',
    actionId: 'act_1',
    storyId,
    branchId,
    abortController: new AbortController(),
    currentPhase: 'narrative',
    intermediates: {},
    terminal: new Promise<void>(() => {}),
    resolveTerminal: () => {},
    interruptible: null,
    beforeTurn: false,
  }
}

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  generationStore.__reset()
  nav.preventRemove = false
  nav.onPrevented = null
  nav.dispatch.mockReset()
  nav.focused = true
  nav.routes = [HOME, READER]
  nav.routeKey = 'reader'
  cancelStoryRuns.mockReset()
  cancelStoryRuns.mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useStoryLeaveGuard', () => {
  it('holds a back that leaves the story while a run on it is in flight', () => {
    generationStore.startRun(inFlightRun('story_1'))
    const { result } = renderHook(() => useStoryLeaveGuard('story_1', 'br_1'))
    expect(nav.preventRemove).toBe(true)

    act(() => nav.onPrevented?.({ data: { action: BACK } }))

    expect(result.current.dialog?.props.open).toBe(true)
    expect(nav.dispatch).not.toHaveBeenCalled()
    expect(cancelStoryRuns).not.toHaveBeenCalled()
  })

  // A Send admitted but not yet registered as a run already owns the branch.
  it('holds a back while a turn is pending on the branch, before its run registers', async () => {
    const admitted = deferred()
    const turn = generationStore.bracketPendingTurn('br_1', () => admitted.promise)
    const { result } = renderHook(() => useStoryLeaveGuard('story_1', 'br_1'))
    expect(nav.preventRemove).toBe(true)

    act(() => nav.onPrevented?.({ data: { action: BACK } }))
    expect(result.current.dialog?.props.open).toBe(true)

    await act(async () => {
      admitted.resolve()
      await turn
    })
  })

  it('ignores a turn pending on another branch', async () => {
    const admitted = deferred()
    const turn = generationStore.bracketPendingTurn('br_2', () => admitted.promise)
    renderHook(() => useStoryLeaveGuard('story_1', 'br_1'))
    expect(nav.preventRemove).toBe(false)

    await act(async () => {
      admitted.resolve()
      await turn
    })
  })

  // In-story moves never ask: a pop onto any in-story screen keeps the story open.
  it.each([
    'reader-composer/[branchId]',
    'world/[branchId]',
    'plot/[branchId]',
    'story-settings/[storyId]',
  ])('lets a back that lands on %s through', (below) => {
    nav.routes = [HOME, { key: 'below', name: below }, WORLD]
    nav.routeKey = 'world'
    generationStore.startRun(inFlightRun('story_1'))
    renderHook(() => useStoryLeaveGuard('story_1', 'br_1'))
    expect(nav.preventRemove).toBe(false)
  })

  it('holds nothing while the story is idle', () => {
    renderHook(() => useStoryLeaveGuard('story_1', 'br_1'))
    expect(nav.preventRemove).toBe(false)
  })

  it("ignores another story's run", () => {
    generationStore.startRun(inFlightRun('story_2', 'br_2'))
    renderHook(() => useStoryLeaveGuard('story_1', 'br_1'))
    expect(nav.preventRemove).toBe(false)
  })

  // Story Settings for a story that isn't the open one has no branch, and nothing in flight.
  it('stays idle with no branch resolved', () => {
    generationStore.startRun(inFlightRun('story_1'))
    const { result } = renderHook(() => useStoryLeaveGuard('story_1', null))
    expect(nav.preventRemove).toBe(false)
    const proceed = vi.fn()
    act(() => result.current.guardLeave(proceed))
    expect(proceed).toHaveBeenCalledTimes(1)
  })

  // A pushed-under screen stays mounted; the focused one above it owns the leave.
  it('leaves an unfocused screen out', () => {
    nav.focused = false
    generationStore.startRun(inFlightRun('story_1'))
    const { result } = renderHook(() => useStoryLeaveGuard('story_1', 'br_1'))
    expect(nav.preventRemove).toBe(false)
    expect(result.current.dialog).toBeNull()
  })

  it("Cancel & leave cancels the story's runs before replaying the held back", async () => {
    generationStore.startRun(inFlightRun('story_1'))
    const cancel = deferred()
    cancelStoryRuns.mockReturnValue(cancel.promise)
    const { result } = renderHook(() => useStoryLeaveGuard('story_1', 'br_1'))
    act(() => nav.onPrevented?.({ data: { action: BACK } }))

    act(() => result.current.dialog?.props.onConfirmLeave())

    expect(cancelStoryRuns).toHaveBeenCalledWith('story_1', 'br_1')
    expect(result.current.dialog?.props.leaving).toBe(true)
    expect(nav.dispatch).not.toHaveBeenCalled()

    await act(async () => {
      cancel.resolve()
    })

    expect(nav.dispatch).toHaveBeenCalledWith(BACK)
    expect(result.current.dialog?.props.open).toBe(false)
    expect(result.current.dialog?.props.leaving).toBe(false)
  })

  // Through the real cancel: a reversal is in flight too, and nothing aborts it.
  it('Cancel & leave waits for a reversal to finish before leaving', async () => {
    cancelStoryRuns.mockImplementation(realCancelStoryRuns)
    generationStore.setReversalInProgress(true)
    const { result } = renderHook(() => useStoryLeaveGuard('story_1', 'br_1'))
    expect(nav.preventRemove).toBe(true)
    act(() => nav.onPrevented?.({ data: { action: BACK } }))

    await act(async () => {
      result.current.dialog?.props.onConfirmLeave()
    })

    expect(cancelStoryRuns).toHaveBeenCalledWith('story_1', 'br_1')
    expect(result.current.dialog?.props.leaving).toBe(true)
    expect(nav.dispatch).not.toHaveBeenCalled()

    act(() => generationStore.setReversalInProgress(false))

    await waitFor(() => expect(nav.dispatch).toHaveBeenCalledWith(BACK))
    expect(result.current.dialog?.props.open).toBe(false)
  })

  it('Stay closes the dialog and leaves the run and the screen alone', () => {
    generationStore.startRun(inFlightRun('story_1'))
    const { result } = renderHook(() => useStoryLeaveGuard('story_1', 'br_1'))
    act(() => nav.onPrevented?.({ data: { action: BACK } }))

    act(() => result.current.dialog?.props.onStay())

    expect(result.current.dialog?.props.open).toBe(false)
    expect(cancelStoryRuns).not.toHaveBeenCalled()
    expect(nav.dispatch).not.toHaveBeenCalled()
  })

  it('runs a guarded push at once while the story is idle', () => {
    const { result } = renderHook(() => useStoryLeaveGuard('story_1', 'br_1'))
    const proceed = vi.fn()
    act(() => result.current.guardLeave(proceed))
    expect(proceed).toHaveBeenCalledTimes(1)
    expect(result.current.dialog?.props.open).toBe(false)
  })

  it('holds a guarded push until Cancel & leave has cancelled the runs', async () => {
    generationStore.startRun(inFlightRun('story_1'))
    const { result } = renderHook(() => useStoryLeaveGuard('story_1', 'br_1'))
    const proceed = vi.fn()
    act(() => result.current.guardLeave(proceed))
    expect(proceed).not.toHaveBeenCalled()
    expect(result.current.dialog?.props.open).toBe(true)

    await act(async () => {
      result.current.dialog?.props.onConfirmLeave()
    })

    expect(cancelStoryRuns).toHaveBeenCalledWith('story_1', 'br_1')
    expect(proceed).toHaveBeenCalledTimes(1)
  })

  it('ignores a second Cancel & leave while the first is still cancelling', async () => {
    generationStore.startRun(inFlightRun('story_1'))
    const cancel = deferred()
    cancelStoryRuns.mockReturnValue(cancel.promise)
    const { result } = renderHook(() => useStoryLeaveGuard('story_1', 'br_1'))
    const proceed = vi.fn()
    act(() => result.current.guardLeave(proceed))

    act(() => result.current.dialog?.props.onConfirmLeave())
    act(() => result.current.dialog?.props.onConfirmLeave())
    await act(async () => {
      cancel.resolve()
    })

    expect(proceed).toHaveBeenCalledTimes(1)
    expect(cancelStoryRuns).toHaveBeenCalledTimes(1)
  })

  // A guard captured at render must decide on the store as it is when pressed.
  it('reads the store when the push is made, not when it rendered', () => {
    const { result } = renderHook(() => useStoryLeaveGuard('story_1', 'br_1'))
    const guard = result.current.guardLeave
    act(() => generationStore.startRun(inFlightRun('story_1')))
    const proceed = vi.fn()
    act(() => guard(proceed))
    expect(proceed).not.toHaveBeenCalled()
    expect(result.current.dialog?.props.open).toBe(true)
  })

  it('keeps the dialog up and logs when the cancel fails', async () => {
    generationStore.startRun(inFlightRun('story_1'))
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    cancelStoryRuns.mockRejectedValue(new Error('terminal lost'))
    const { result } = renderHook(() => useStoryLeaveGuard('story_1', 'br_1'))
    act(() => nav.onPrevented?.({ data: { action: BACK } }))

    await act(async () => {
      result.current.dialog?.props.onConfirmLeave()
    })

    expect(nav.dispatch).not.toHaveBeenCalled()
    expect(result.current.dialog?.props.open).toBe(true)
    expect(result.current.dialog?.props.leaving).toBe(false)
    expect(logger.error).toHaveBeenCalledWith(
      'app.story_leave_cancel_failed',
      expect.objectContaining({ storyId: 'story_1', branchId: 'br_1', error: 'terminal lost' }),
    )
  })

  // Replayed later, a leave held on a screen that lost focus would navigate unasked.
  it('drops a held leave when the screen loses focus', () => {
    generationStore.startRun(inFlightRun('story_1'))
    const { result, rerender } = renderHook(() => useStoryLeaveGuard('story_1', 'br_1'))
    act(() => nav.onPrevented?.({ data: { action: BACK } }))

    nav.focused = false
    rerender()
    expect(result.current.dialog).toBeNull()
    nav.focused = true
    rerender()

    expect(result.current.dialog?.props.open).toBe(false)
  })
})
