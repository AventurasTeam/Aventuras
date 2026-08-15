// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_CALENDAR_ID, getCalendar } from '@/lib/calendar'
import type { StoryEntry } from '@/lib/db'

import { useWorldTimeEditing } from './world-time-editing'

const updateEntryWorldTime = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<{ status: string; reason?: string }>>(),
)

vi.mock('@/lib/actions', () => ({ updateEntryWorldTime }))

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
})
afterEach(cleanup)

// No default parameter for `calendarId`: passing `undefined` explicitly is the
// case under test, and a default would silently swallow it.
function render(entries: StoryEntry[], calendarId: string | undefined) {
  return renderHook(
    ({ rows }: { rows: StoryEntry[] }) => useWorldTimeEditing('b1', rows, calendarId, ORIGIN, CTX),
    { initialProps: { rows: entries } },
  )
}

describe('useWorldTimeEditing → calendar resolution', () => {
  it('falls back to the default calendar for an id the registry does not know', () => {
    const { result } = render(ENTRIES, 'cal_default')
    // Not merely non-null: the fallback must be the default, not the requested id.
    expect(result.current.calendar).toBe(getCalendar(DEFAULT_CALENDAR_ID))
    expect(result.current.calendar?.id).not.toBe('cal_default')
    // A resolved calendar is what makes the footers editable at all.
    expect(Object.keys(result.current.worldTimeDecorations)).toEqual(['e1', 'e2'])
  })

  it('leaves the calendar null — and every footer undecorated — with no story open', () => {
    const { result } = render(ENTRIES, undefined)
    expect(result.current.calendar).toBeNull()
    expect(result.current.worldTimeDecorations).toEqual({})
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
  it('reports a rejected write as a result rather than throwing', async () => {
    updateEntryWorldTime.mockResolvedValue({ status: 'rejected', reason: 'generation in flight' })
    const { result } = render(ENTRIES, 'earth-gregorian')
    await expect(result.current.editWorldTime('e2', 180)).resolves.toEqual({ ok: false })
  })

  it('reports a thrown write as a result rather than rejecting', async () => {
    updateEntryWorldTime.mockRejectedValue(new Error('database is locked'))
    const { result } = render(ENTRIES, 'earth-gregorian')
    await expect(result.current.editWorldTime('e2', 180)).resolves.toEqual({ ok: false })
  })

  it('reports a successful write as ok', async () => {
    updateEntryWorldTime.mockResolvedValue({ status: 'ok' })
    const { result } = render(ENTRIES, 'earth-gregorian')
    await expect(result.current.editWorldTime('e2', 180)).resolves.toEqual({ ok: true })
  })
})
