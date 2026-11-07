// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  INITIAL_CHAPTER_EXPANSION,
  nextExpandedChapter,
  useChapterExpansion,
  type ChapterExpansionInput,
  type ChapterExpansionState,
} from './chapter-expansion'

type Row = ChapterExpansionInput['rows'][number]

const row = (sequenceNumber: number, id = `chap_${sequenceNumber}`): Row => ({
  id,
  sequenceNumber,
})

function input(overrides: Partial<ChapterExpansionInput> = {}): ChapterExpansionInput {
  return { ready: true, rows: [], runInFlight: false, dirty: false, ...overrides }
}

/** Feeds the inputs in order, as the route's renders would. */
function judge(
  inputs: readonly ChapterExpansionInput[],
  from: ChapterExpansionState = INITIAL_CHAPTER_EXPANSION,
): ChapterExpansionState {
  return inputs.reduce(nextExpandedChapter, from)
}

afterEach(() => {
  cleanup()
})

describe('nextExpandedChapter', () => {
  it('changes nothing until the route is ready', () => {
    const notReady = input({ ready: false, rows: [row(1), row(2)] })
    expect(nextExpandedChapter(INITIAL_CHAPTER_EXPANSION, notReady)).toBe(INITIAL_CHAPTER_EXPANSION)

    // Before hydration the rows are empty: an open card must not be pruned against them.
    const open: ChapterExpansionState = { expandedId: 'chap_1', baseline: 1 }
    expect(nextExpandedChapter(open, input({ ready: false }))).toBe(open)
  })

  it('expands none of the rows the ready route first sees', () => {
    const first = input({ rows: [row(2), row(1)] })
    const state = judge([first])
    expect(state).toEqual({ expandedId: null, baseline: 2 })
    expect(nextExpandedChapter(state, first)).toBe(state)
  })

  it('takes the baseline from the highest sequence number, not position, id or count', () => {
    // Highest is in the middle, its id sorts lowest, and 12 sorts below 9 as a string.
    const rows = [row(9, 'chap_z'), row(12, 'chap_a'), row(3, 'chap_m')]
    const state = judge([input({ rows })])
    expect(state).toEqual({ expandedId: null, baseline: 12 })

    // A row at 10 or 11 sits under the baseline, so it is no newcomer.
    const below = nextExpandedChapter(state, input({ rows: [...rows, row(11, 'chap_y')] }))
    expect(below).toBe(state)
  })

  it('takes the baseline from the first ready rows even under a run', () => {
    const rows = [row(1), row(2), row(3)]
    const state = judge([input({ rows, runInFlight: true }), input({ rows })])
    expect(state).toEqual({ expandedId: null, baseline: 3 })
  })

  it('expands the close of a run the route became ready during', () => {
    const rows = [row(9, 'chap_c'), row(3, 'chap_q'), row(12, 'chap_a')]
    const state = judge([
      input({ rows, runInFlight: true }),
      input({ rows: [row(13, 'chap_b'), ...rows] }),
    ])
    expect(state).toEqual({ expandedId: 'chap_b', baseline: 13 })
  })

  it("expands a story's first chapter, landing on an empty branch", () => {
    const state = judge([input({ rows: [] }), input({ rows: [row(1)] })])
    expect(state).toEqual({ expandedId: 'chap_1', baseline: 1 })
  })

  it('judges a newcomer only once its run has ended', () => {
    const before = judge([input({ rows: [row(1), row(2)] })])
    const during = input({ rows: [row(1), row(2), row(3)], runInFlight: true })
    expect(nextExpandedChapter(before, during)).toBe(before)

    const after = nextExpandedChapter(before, { ...during, runInFlight: false })
    expect(after).toEqual({ expandedId: 'chap_3', baseline: 3 })
  })

  it('never expands a newcomer that left before its run ended', () => {
    const state = judge([
      input({ rows: [row(1), row(2)] }),
      input({ rows: [row(1), row(2), row(3)], runInFlight: true }),
      input({ rows: [row(1), row(2)], runInFlight: true }),
      input({ rows: [row(1), row(2)] }),
    ])
    expect(state).toEqual({ expandedId: null, baseline: 2 })

    // Never judged, so the next chapter at that number is still new.
    const next = nextExpandedChapter(state, input({ rows: [row(1), row(2), row(3, 'chap_3b')] }))
    expect(next).toEqual({ expandedId: 'chap_3b', baseline: 3 })
  })

  it('expands a newcomer once: a collapse keeps it collapsed', () => {
    const rows = [row(1), row(2)]
    const landed = judge([input({ rows: [row(1)] }), input({ rows })])
    expect(landed).toEqual({ expandedId: 'chap_2', baseline: 2 })
    expect(nextExpandedChapter(landed, input({ rows }))).toBe(landed)

    const collapsed: ChapterExpansionState = { ...landed, expandedId: null }
    expect(nextExpandedChapter(collapsed, input({ rows }))).toBe(collapsed)
  })

  it('expands only the newest of several newcomers', () => {
    const state = judge([input({ rows: [row(1)] }), input({ rows: [row(1), row(2), row(3)] })])
    expect(state).toEqual({ expandedId: 'chap_3', baseline: 3 })
  })

  it('picks the newest newcomer by sequence number, not position or id', () => {
    const ready = judge([input({ rows: [row(8, 'chap_h')] })])
    // First and lowest newcomer is chap_z (also the highest id and 9 > 12 as a string), the last
    // is chap_a; the newest, at 12, is chap_m in between.
    const rows = [row(9, 'chap_z'), row(8, 'chap_h'), row(12, 'chap_m'), row(10, 'chap_a')]
    expect(nextExpandedChapter(ready, input({ rows }))).toEqual({
      expandedId: 'chap_m',
      baseline: 12,
    })
  })

  it('drops an expanded id whose row went, and keeps it dropped when the row returns', () => {
    const ready = judge([input({ rows: [row(1), row(2)] })])
    const open: ChapterExpansionState = { ...ready, expandedId: 'chap_1' }
    const gone = nextExpandedChapter(open, input({ rows: [row(2)] }))
    expect(gone).toEqual({ expandedId: null, baseline: 2 })
    expect(nextExpandedChapter(gone, input({ rows: [row(1), row(2)] }))).toBe(gone)
  })

  it('keeps an expanded id by its row id, whatever its position', () => {
    const rows = [row(4, 'chap_d'), row(11, 'chap_k'), row(7, 'chap_g')]
    const ready = judge([input({ rows })])
    const open: ChapterExpansionState = { ...ready, expandedId: 'chap_g' }
    expect(nextExpandedChapter(open, input({ rows: [rows[2], rows[0], rows[1]] }))).toBe(open)
  })

  it('drops an expanded id whose row went during a run', () => {
    const ready = judge([input({ rows: [row(1), row(2)] })])
    const during = nextExpandedChapter(
      ready,
      input({ rows: [row(1), row(2), row(3)], runInFlight: true }),
    )
    const opened: ChapterExpansionState = { ...during, expandedId: 'chap_3' }
    const reversed = nextExpandedChapter(
      opened,
      input({ rows: [row(1), row(2)], runInFlight: true }),
    )
    expect(reversed).toEqual({ expandedId: null, baseline: 2 })
  })

  it("spends a newcomer's chance on a dirty card", () => {
    const ready = judge([input({ rows: [row(1), row(2)] })])
    const editing: ChapterExpansionState = { ...ready, expandedId: 'chap_1' }
    const rows = [row(1), row(2), row(3)]
    const landed = nextExpandedChapter(editing, input({ rows, dirty: true }))
    expect(landed).toEqual({ expandedId: 'chap_1', baseline: 3 })

    // Saved or discarded later: the newcomer doesn't pull itself open.
    expect(nextExpandedChapter(landed, input({ rows }))).toBe(landed)
  })

  it('leaves a re-close at a judged sequence number collapsed', () => {
    const closed = judge([
      input({ rows: [row(1), row(2)] }),
      input({ rows: [row(1), row(2), row(3)] }),
    ])
    expect(closed.expandedId).toBe('chap_3')

    const undone = nextExpandedChapter(closed, input({ rows: [row(1), row(2)] }))
    const reclosed = nextExpandedChapter(
      undone,
      input({ rows: [row(1), row(2), row(3, 'chap_3b')] }),
    )
    expect(reclosed).toEqual({ expandedId: null, baseline: 3 })
  })
})

describe('useChapterExpansion', () => {
  it('expands a newcomer in the render its row arrives', () => {
    const seen: (string | null)[] = []
    const { rerender } = renderHook(
      (props: ChapterExpansionInput) => {
        const expansion = useChapterExpansion(props)
        seen.push(expansion.expandedId)
        return expansion
      },
      { initialProps: input({ rows: [row(1)] }) },
    )
    expect(seen.at(-1)).toBeNull()

    const before = seen.length
    rerender(input({ rows: [row(1), row(2)] }))
    expect(seen.slice(before)).not.toHaveLength(0)
    expect(seen.slice(before).every((id) => id === 'chap_2')).toBe(true)
  })

  it("takes a user's expand and collapse", () => {
    const rows = [row(1), row(2)]
    const { result } = renderHook(() => useChapterExpansion(input({ rows })))
    expect(result.current.expandedId).toBeNull()

    act(() => result.current.setExpanded('chap_1'))
    expect(result.current.expandedId).toBe('chap_1')

    act(() => result.current.setExpanded(null))
    expect(result.current.expandedId).toBeNull()
  })

  it("keeps a newcomer judgeable across a user's expand during its run", () => {
    const { result, rerender } = renderHook(
      (props: ChapterExpansionInput) => useChapterExpansion(props),
      { initialProps: input({ rows: [row(1), row(2)] }) },
    )
    const during = input({ rows: [row(1), row(2), row(3)], runInFlight: true })
    rerender(during)

    act(() => result.current.setExpanded('chap_1'))
    expect(result.current.expandedId).toBe('chap_1')

    rerender({ ...during, runInFlight: false })
    expect(result.current.expandedId).toBe('chap_3')
  })
})
