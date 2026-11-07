// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ChapterSaveResult } from '@/lib/actions'
import { CHAPTER_CLOSE_KIND, type ChapterDraftRow } from '@/lib/chapters'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { PER_TURN_KIND } from '@/lib/pipeline'
import { CLOSE_RANGE_INTERMEDIATE_KEY } from '@/lib/pipeline/definitions/intermediates'
import { generationStore, type RunState, type StoreChapter } from '@/lib/stores'

import { useTimelineEditing, type TimelineEditingOptions } from './use-timeline-editing'

// Navigation and the window-close bridge have their own tests; this file pins the composition.
vi.mock('@/hooks/use-surface-navigate', () => ({ useSurfaceNavigate: () => vi.fn() }))
vi.mock('@/hooks/use-unsaved-changes-guard', () => ({ useUnsavedChangesGuard: () => {} }))

function chapter(sequenceNumber: number): StoreChapter {
  return {
    id: `chap_${sequenceNumber}`,
    branchId: 'br_1',
    sequenceNumber,
    title: `Chapter ${sequenceNumber}`,
    summary: `What happened in chapter ${sequenceNumber}.`,
    theme: '',
    keywords: [],
    startEntryId: `entry_${sequenceNumber}_start`,
    endEntryId: `entry_${sequenceNumber}_end`,
    tokenCount: 1_000,
    closedAt: 0,
    embeddingStale: 0,
    createdAt: 0,
    updatedAt: 0,
    hasCloseReport: false,
  }
}

const ONE = chapter(1)
const TWO = chapter(2)
const THREE = chapter(3)
const BEFORE = [ONE, TWO]
const AFTER = [ONE, TWO, THREE]

type Props = Pick<TimelineEditingOptions, 'ready' | 'rows' | 'runInFlight'>

function setup(initialProps: Props = { ready: true, rows: BEFORE, runInFlight: false }) {
  const save = vi.fn(
    async (row: ChapterDraftRow): Promise<ChapterSaveResult> => ({ status: 'ok', id: row.id }),
  )
  const hook = renderHook(
    (props: Props) =>
      useTimelineEditing({
        ...props,
        branchId: 'br_1',
        save,
        onSaved: vi.fn(),
        onRejected: vi.fn(),
      }),
    { initialProps },
  )
  return Object.assign(hook, { save })
}

type Hook = ReturnType<typeof setup>

function open(hook: Hook, id: string) {
  act(() => hook.result.current.toggle(id))
  expect(hook.result.current.expandedId).toBe(id)
}

async function editTitle(hook: Hook, title: string) {
  act(() => hook.result.current.session.form.setValue('title', title, { shouldDirty: true }))
  await waitFor(() => expect(hook.result.current.session.dirty).toBe(true))
}

/** A close lands mid-run, then the run ends. */
function closeLands(hook: Hook) {
  hook.rerender({ ready: true, rows: BEFORE, runInFlight: true })
  hook.rerender({ ready: true, rows: AFTER, runInFlight: true })
  hook.rerender({ ready: true, rows: AFTER, runInFlight: false })
}

/** A run already going on the branch, as the orchestrator registers it. */
function runAlready(kind: string, interruptible: RunState['interruptible'] = null): RunState {
  const run: RunState = {
    runId: `run_${kind}`,
    kind,
    gateBehavior: 'hard-gate',
    interruptible,
    beforeTurn: false,
    actionId: `act_${kind}`,
    storyId: 'story_1',
    branchId: 'br_1',
    abortController: new AbortController(),
    currentPhase: '',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  }
  generationStore.startRun(run)
  return run
}

/** The close's boundary phase: it parks the new chapter's id, then the next phase starts. */
function parkRange(close: RunState, chapterId: string) {
  act(() => {
    close.intermediates[CLOSE_RANGE_INTERMEDIATE_KEY] = {
      chapterId,
      startEntryId: 'entry_3_start',
      endEntryId: 'entry_3_end',
    }
    generationStore.setCurrentPhase(close.runId, 'metadata')
  })
}

function runEnds(hook: Hook, run: RunState, rows: readonly StoreChapter[]) {
  act(() => generationStore.finishRun(run.runId))
  hook.rerender({ ready: true, rows, runInFlight: false })
}

/** Mounted mid-run: the cold open publishes the story with these rows already hydrated. */
function openDuringRun(rows: readonly StoreChapter[]): Hook {
  const hook = setup({ ready: false, rows: [], runInFlight: true })
  hook.rerender({ ready: true, rows, runInFlight: true })
  expect(hook.result.current.expandedId).toBeNull()
  return hook
}

afterEach(() => {
  cleanup()
  generationStore.__reset()
})

describe('useTimelineEditing', () => {
  it('keeps a dirty card open, with its draft, when a close lands and its run ends', async () => {
    const hook = setup()
    open(hook, ONE.id)
    await editTitle(hook, 'Chapter 1, revised')

    closeLands(hook)
    expect(hook.result.current.expandedId).toBe(ONE.id)
    expect(hook.result.current.session.form.getValues('title')).toBe('Chapter 1, revised')
    expect(hook.result.current.session.dirty).toBe(true)
  })

  it('moves a clean card aside for the close that lands', () => {
    const hook = setup()
    open(hook, ONE.id)
    closeLands(hook)
    expect(hook.result.current.expandedId).toBe(THREE.id)
    expect(hook.result.current.session.form.getValues('title')).toBe(THREE.title)
  })

  it('holds a close that lands mid-run until the run ends', () => {
    const hook = setup()
    open(hook, ONE.id)
    hook.rerender({ ready: true, rows: AFTER, runInFlight: true })
    expect(hook.result.current.expandedId).toBe(ONE.id)
    hook.rerender({ ready: true, rows: AFTER, runInFlight: false })
    expect(hook.result.current.expandedId).toBe(THREE.id)
  })

  it('opens nothing for the chapters a cold open hydrates', () => {
    const hook = setup({ ready: false, rows: [], runInFlight: false })
    hook.rerender({ ready: true, rows: AFTER, runInFlight: false })
    expect(hook.result.current.expandedId).toBeNull()
  })

  it('collapses the open card when its own head is pressed', () => {
    const hook = setup()
    open(hook, ONE.id)
    act(() => hook.result.current.toggle(ONE.id))
    expect(hook.result.current.expandedId).toBeNull()
  })

  it('holds a switch away from a dirty card behind the leave guard', async () => {
    const hook = setup()
    open(hook, ONE.id)
    await editTitle(hook, 'Chapter 1, revised')

    act(() => hook.result.current.toggle(TWO.id))
    expect(hook.result.current.expandedId).toBe(ONE.id)
    expect(hook.result.current.session.pendingLeave).toBe(true)
  })

  it('keys the session to the card a switch opens, and saves that row', async () => {
    const hook = setup()
    open(hook, ONE.id)
    act(() => hook.result.current.toggle(TWO.id))
    expect(hook.result.current.expandedId).toBe(TWO.id)
    await waitFor(() => expect(hook.result.current.session.formRowId).toBe(TWO.id))

    await editTitle(hook, 'Chapter 2, revised')
    await act(async () => {
      await hook.result.current.session.save()
    })
    expect(hook.save).toHaveBeenCalledTimes(1)
    expect(hook.save).toHaveBeenCalledWith(
      TWO,
      expect.objectContaining({ title: 'Chapter 2, revised' }),
    )
  })
})

describe('useTimelineEditing, opened while a run is going', () => {
  it("opens the chapter a running close had written once its run ends, as a fresh close's", () => {
    const close = runAlready(CHAPTER_CLOSE_KIND, 'close')
    parkRange(close, THREE.id)
    const hook = openDuringRun(AFTER)

    runEnds(hook, close, AFTER)
    expect(hook.result.current.expandedId).toBe(THREE.id)
    expect(hook.result.current.session.form.getValues('title')).toBe(THREE.title)
  })

  it.each([
    ['before it has parked its range', false],
    ['after it has parked its range', true],
  ])('opens the chapter of a close it opened under, %s, once the row lands', (_, parked) => {
    const close = runAlready(CHAPTER_CLOSE_KIND, 'close')
    if (parked) parkRange(close, THREE.id)
    const hook = openDuringRun(BEFORE)
    if (!parked) parkRange(close, THREE.id)

    hook.rerender({ ready: true, rows: AFTER, runInFlight: true })
    expect(hook.result.current.expandedId).toBeNull()
    runEnds(hook, close, AFTER)
    expect(hook.result.current.expandedId).toBe(THREE.id)
  })

  it.each([
    ['a pass', PERIODIC_CLASSIFIER_KIND, 'pass'],
    ['a turn', PER_TURN_KIND, null],
  ] as const)('opens none of the chapters there under %s', (_, kind, interruptible) => {
    const run = runAlready(kind, interruptible)
    const hook = openDuringRun(AFTER)

    runEnds(hook, run, AFTER)
    expect(hook.result.current.expandedId).toBeNull()
  })

  it('drops the chapter of a close that aborts, and opens nothing when its run ends', () => {
    const close = runAlready(CHAPTER_CLOSE_KIND, 'close')
    parkRange(close, THREE.id)
    const hook = openDuringRun(AFTER)
    open(hook, THREE.id)

    // The abort reverse-replays the close's writes before it releases the gate.
    hook.rerender({ ready: true, rows: BEFORE, runInFlight: true })
    expect(hook.result.current.expandedId).toBeNull()

    act(() => {
      generationStore.abortRun(close.runId, 'aborted')
    })
    hook.rerender({ ready: true, rows: BEFORE, runInFlight: false })
    expect(hook.result.current.expandedId).toBeNull()
  })

  it("spends the close's chapter on a dirty card: it stays shut once the card is clean", async () => {
    const close = runAlready(CHAPTER_CLOSE_KIND, 'close')
    parkRange(close, THREE.id)
    const hook = openDuringRun(AFTER)
    open(hook, ONE.id)
    await editTitle(hook, 'Chapter 1, revised')

    runEnds(hook, close, AFTER)
    expect(hook.result.current.expandedId).toBe(ONE.id)

    act(() => hook.result.current.session.discard())
    await waitFor(() => expect(hook.result.current.session.dirty).toBe(false))
    hook.rerender({ ready: true, rows: AFTER, runInFlight: false })
    expect(hook.result.current.expandedId).toBe(ONE.id)
  })
})
