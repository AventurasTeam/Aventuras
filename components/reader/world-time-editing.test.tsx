// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_CALENDAR_ID, getCalendar } from '@/lib/calendar'
import type { StoryEntry } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { toast } from '@/lib/toast'

import { useWorldTimeEditing } from './world-time-editing'

const updateEntryWorldTime = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<{ status: string; reason?: string }>>(),
)

vi.mock('@/lib/actions', () => ({ updateEntryWorldTime }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const ORIGIN = { year: 2024, month: 1, day: 1, hour: 0, minute: 0, second: 0 }
const CTX = {} as never

function entry(id: string, position: number, worldTime: number | null): StoryEntry {
  return {
    id,
    branchId: 'b1',
    chapterId: null,
    kind: 'ai_reply',
    content: 'x',
    position,
    createdAt: 0,
    metadata: worldTime == null ? null : { sceneEntities: [], currentLocationId: null, worldTime },
  } as StoryEntry
}

const ENTRIES = [entry('e1', 1, 60), entry('e2', 2, 120)]

// Block body, not a concise one: `mockReset()` returns the mock, and a function
// returned from `beforeEach` is registered as a teardown callback and invoked.
beforeEach(() => {
  updateEntryWorldTime.mockReset()
  vi.mocked(toast.error).mockClear()
  vi.spyOn(logger, 'warn').mockImplementation(() => {})
  vi.spyOn(logger, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  // `logger` is a singleton: a spy left on it accumulates calls across tests,
  // so a later assertion can be satisfied by an earlier test's call.
  vi.restoreAllMocks()
})

// No default parameter for `calendarId`: passing `undefined` explicitly is the
// case under test, and a default would silently swallow it.
function render(entries: StoryEntry[], calendarId: string | undefined) {
  return renderHook(
    ({ rows }: { rows: StoryEntry[] }) => useWorldTimeEditing('b1', rows, calendarId, ORIGIN, CTX),
    { initialProps: { rows: entries } },
  )
}

describe('useWorldTimeEditing → calendar resolution', () => {
  // The registry currently holds only the default, so this pins the fallback
  // arm; the "resolves the requested id" arm is unfalsifiable until a second
  // calendar is registered, and no assertion here can stand in for it.
  it('falls back to the default calendar for an id the registry does not know', () => {
    const { result } = render(ENTRIES, 'cal_default')
    expect(result.current.worldTimeFrame?.calendar).toBe(getCalendar(DEFAULT_CALENDAR_ID))
    // A resolved calendar is what makes the footers editable at all.
    expect(Object.keys(result.current.worldTimeDecorations)).toEqual(['e1', 'e2'])
  })

  // The read/write split: the fallback keeps footers rendered, but a tuple picked
  // against it would persist under a calendar the story is not using.
  it('refuses to open the edit sheet for an id the registry does not know', async () => {
    const { result } = render(ENTRIES, 'cal_default')

    await act(async () => {
      await result.current.requestEditWorldTime('e1')
    })

    expect(result.current.timeEdit).toBeNull()
  })

  it('opens the edit sheet when the calendar resolves', async () => {
    const { result } = render(ENTRIES, 'earth-gregorian')

    await act(async () => {
      await result.current.requestEditWorldTime('e1')
    })

    // Positive control: the refusal above also passes on a hook that never opens.
    expect(result.current.timeEdit?.entryId).toBe('e1')
  })

  it('pairs the resolved calendar with the story origin', () => {
    const { result } = render(ENTRIES, 'earth-gregorian')
    expect(result.current.worldTimeFrame?.origin).toBe(ORIGIN)
  })

  it('leaves the frame null — and every footer undecorated — with no story open', () => {
    const { result } = render(ENTRIES, undefined)
    expect(result.current.worldTimeFrame).toBeNull()
    expect(result.current.worldTimeDecorations).toEqual({})
  })

  // Both halves cross the ReaderRow seam as one prop, so a frame rebuilt per
  // render would void the row memo exactly as a merged decoration would.
  it('keeps one frame identity across re-renders', () => {
    const { result, rerender } = render(ENTRIES, 'earth-gregorian')
    const first = result.current.worldTimeFrame
    rerender({ rows: ENTRIES })
    expect(result.current.worldTimeFrame).toBe(first)
  })
})

describe('useWorldTimeEditing → decoration memo', () => {
  // The walk runs once per entries-collection identity. A stream chunk or an
  // unrelated store write re-renders the route without touching `entries`, and
  // a fresh decorations object there would hand every ReaderRow new primitives
  // and void its memo.
  it('reuses the walk for the same entries reference and redoes it for a new one', async () => {
    const { result, rerender } = render(ENTRIES, 'earth-gregorian')
    const first = result.current.worldTimeDecorations
    expect(Object.keys(first)).toEqual(['e1', 'e2'])

    await act(async () => rerender({ rows: ENTRIES }))
    expect(result.current.worldTimeDecorations).toBe(first)

    // A new array over the same rows is what every entries patch produces
    // (working-set-store rebuilds the Map, so the route's sort re-runs).
    await act(async () => rerender({ rows: [...ENTRIES] }))
    expect(result.current.worldTimeDecorations).not.toBe(first)
    expect(result.current.worldTimeDecorations).toEqual(first)
  })
})

describe('useWorldTimeEditing → stale edit target', () => {
  it('drops the pending id when the entry disappears from the decorations', async () => {
    const { result, rerender } = render(ENTRIES, 'earth-gregorian')

    await act(async () => {
      await result.current.requestEditWorldTime('e2')
    })
    expect(result.current.timeEdit?.entryId).toBe('e2')

    // A rollback / branch switch takes the entry out from under the open sheet.
    await act(async () => rerender({ rows: [ENTRIES[0]] }))
    expect(result.current.timeEdit).toBeNull()

    // The id is gone, not merely hidden: bringing the entry back — as a redo
    // does — must not resurrect the overlay.
    await act(async () => rerender({ rows: ENTRIES }))
    expect(result.current.timeEdit).toBeNull()
  })
})

describe('useWorldTimeEditing → edit result channel', () => {
  it('reports a rejected write as a result and leaves presentation to the editor', async () => {
    updateEntryWorldTime.mockResolvedValue({ status: 'rejected', reason: 'generation in flight' })
    const { result } = render(ENTRIES, 'earth-gregorian')
    await expect(result.current.editWorldTime('e2', 180)).resolves.toEqual({ ok: false })
    expect(toast.error).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      'action_layer.world_time_edit_rejected',
      expect.objectContaining({ entryId: 'e2', reason: 'generation in flight' }),
    )
  })

  it('reports a thrown write as a result and leaves presentation to the editor', async () => {
    updateEntryWorldTime.mockRejectedValue(new Error('database is locked'))
    const { result } = render(ENTRIES, 'earth-gregorian')
    await expect(result.current.editWorldTime('e2', 180)).resolves.toEqual({ ok: false })
    expect(toast.error).not.toHaveBeenCalled()
    // A throw is a different diagnostic from a rejection: error, not warn.
    expect(logger.error).toHaveBeenCalledWith(
      'action_layer.world_time_edit_failed',
      expect.objectContaining({ entryId: 'e2', error: 'database is locked' }),
    )
  })

  it('reports a successful write as ok and stays quiet', async () => {
    updateEntryWorldTime.mockResolvedValue({ status: 'ok' })
    const { result } = render(ENTRIES, 'earth-gregorian')
    await expect(result.current.editWorldTime('e2', 180)).resolves.toEqual({ ok: true })
    expect(toast.error).not.toHaveBeenCalled()
  })
})
