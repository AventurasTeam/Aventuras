// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

const judged = (...ids: string[]): ReadonlySet<string> => new Set(ids)

const passThrough = (proceed: () => void) => proceed()

type HookProps = ChapterExpansionInput & { guard: (proceed: () => void) => void }

const hookProps = (overrides: Partial<HookProps> = {}): HookProps => ({
  ...input(),
  guard: passThrough,
  ...overrides,
})

afterEach(() => {
  cleanup()
})

describe('nextExpandedChapter', () => {
  it('changes nothing until the route is ready', () => {
    const notReady = input({ ready: false, rows: [row(1), row(2)] })
    expect(nextExpandedChapter(INITIAL_CHAPTER_EXPANSION, notReady)).toBe(INITIAL_CHAPTER_EXPANSION)

    // Before hydration the rows are empty: an open card must not be pruned against them.
    const open: ChapterExpansionState = { expandedId: 'chap_1', judged: judged('chap_1') }
    expect(nextExpandedChapter(open, input({ ready: false }))).toBe(open)
  })

  it('expands none of the rows the ready route first sees', () => {
    const first = input({ rows: [row(2), row(1)] })
    const state = judge([first])
    expect(state).toEqual({ expandedId: null, judged: judged('chap_2', 'chap_1') })
    expect(nextExpandedChapter(state, first)).toBe(state)
  })

  it('judges the first ready rows by id, so a later row below them is still new', () => {
    const rows = [row(9, 'chap_z'), row(12, 'chap_a'), row(3, 'chap_m')]
    const state = judge([input({ rows })])
    expect(state).toEqual({ expandedId: null, judged: judged('chap_z', 'chap_a', 'chap_m') })

    const below = nextExpandedChapter(state, input({ rows: [...rows, row(11, 'chap_y')] }))
    expect(below.expandedId).toBe('chap_y')
    expect(below.judged).toEqual(judged('chap_z', 'chap_a', 'chap_m', 'chap_y'))
  })

  it('judges the first ready rows even under a run', () => {
    const rows = [row(1), row(2), row(3)]
    const state = judge([input({ rows, runInFlight: true }), input({ rows })])
    expect(state).toEqual({ expandedId: null, judged: judged('chap_1', 'chap_2', 'chap_3') })
  })

  it('expands the close of a run the route became ready during', () => {
    const rows = [row(9, 'chap_c'), row(3, 'chap_q'), row(12, 'chap_a')]
    const state = judge([
      input({ rows, runInFlight: true }),
      input({ rows: [row(13, 'chap_b'), ...rows] }),
    ])
    expect(state.expandedId).toBe('chap_b')
  })

  it("expands a story's first chapter, landing on an empty branch", () => {
    const state = judge([input({ rows: [] }), input({ rows: [row(1)] })])
    expect(state).toEqual({ expandedId: 'chap_1', judged: judged('chap_1') })
  })

  it('judges a newcomer only once its run has ended', () => {
    const before = judge([input({ rows: [row(1), row(2)] })])
    const during = input({ rows: [row(1), row(2), row(3)], runInFlight: true })
    expect(nextExpandedChapter(before, during)).toBe(before)

    const after = nextExpandedChapter(before, { ...during, runInFlight: false })
    expect(after).toEqual({ expandedId: 'chap_3', judged: judged('chap_1', 'chap_2', 'chap_3') })
  })

  it('never expands a newcomer that left before its run ended', () => {
    const state = judge([
      input({ rows: [row(1), row(2)] }),
      input({ rows: [row(1), row(2), row(3)], runInFlight: true }),
      input({ rows: [row(1), row(2)], runInFlight: true }),
      input({ rows: [row(1), row(2)] }),
    ])
    expect(state).toEqual({ expandedId: null, judged: judged('chap_1', 'chap_2') })

    const next = nextExpandedChapter(state, input({ rows: [row(1), row(2), row(3, 'chap_3b')] }))
    expect(next.expandedId).toBe('chap_3b')
  })

  it('expands a newcomer once: a collapse keeps it collapsed', () => {
    const rows = [row(1), row(2)]
    const landed = judge([input({ rows: [row(1)] }), input({ rows })])
    expect(landed.expandedId).toBe('chap_2')
    expect(nextExpandedChapter(landed, input({ rows }))).toBe(landed)

    const collapsed: ChapterExpansionState = { ...landed, expandedId: null }
    expect(nextExpandedChapter(collapsed, input({ rows }))).toBe(collapsed)
  })

  it('expands only the newest of several newcomers, judging them all', () => {
    const landing = input({ rows: [row(1), row(2), row(3)] })
    const state = judge([input({ rows: [row(1)] }), landing])
    expect(state).toEqual({ expandedId: 'chap_3', judged: judged('chap_1', 'chap_2', 'chap_3') })
    expect(nextExpandedChapter(state, landing)).toBe(state)
  })

  it('picks the newest newcomer by sequence number, not position or id', () => {
    const ready = judge([input({ rows: [row(8, 'chap_h')] })])
    // First and lowest newcomer is chap_z (also the highest id and 9 > 12 as a string), the last
    // is chap_a; the newest, at 12, is chap_m in between.
    const rows = [row(9, 'chap_z'), row(8, 'chap_h'), row(12, 'chap_m'), row(10, 'chap_a')]
    expect(nextExpandedChapter(ready, input({ rows })).expandedId).toBe('chap_m')
  })

  it('drops an expanded id whose row went, and keeps it dropped when the row returns', () => {
    const ready = judge([input({ rows: [row(1), row(2)] })])
    const open: ChapterExpansionState = { ...ready, expandedId: 'chap_1' }
    const gone = nextExpandedChapter(open, input({ rows: [row(2)] }))
    expect(gone).toEqual({ expandedId: null, judged: judged('chap_1', 'chap_2') })
    expect(nextExpandedChapter(gone, input({ rows: [row(1), row(2)] }))).toBe(gone)
  })

  it('drops an expanded id when the last chapter goes', () => {
    const open: ChapterExpansionState = { expandedId: 'chap_1', judged: judged('chap_1') }
    expect(nextExpandedChapter(open, input({ rows: [] }))).toEqual({
      expandedId: null,
      judged: judged('chap_1'),
    })
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
    expect(reversed).toEqual({ expandedId: null, judged: judged('chap_1', 'chap_2') })
  })

  it("spends a newcomer's chance on a dirty card", () => {
    const ready = judge([input({ rows: [row(1), row(2)] })])
    const editing: ChapterExpansionState = { ...ready, expandedId: 'chap_1' }
    const rows = [row(1), row(2), row(3)]
    const landed = nextExpandedChapter(editing, input({ rows, dirty: true }))
    expect(landed).toEqual({ expandedId: 'chap_1', judged: judged('chap_1', 'chap_2', 'chap_3') })

    // Saved or discarded later: the newcomer doesn't pull itself open.
    expect(nextExpandedChapter(landed, input({ rows }))).toBe(landed)
  })

  it('expands a re-close at the number an undone close held', () => {
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
    expect(reclosed.expandedId).toBe('chap_3b')
  })

  it('expands a re-close below the numbers a rollback swept', () => {
    const rows = [row(1), row(2), row(3), row(4), row(5)]
    const ready = judge([input({ rows })])
    const rolledBack = nextExpandedChapter(ready, input({ rows: [row(1), row(2)] }))
    const reclosed = nextExpandedChapter(
      rolledBack,
      input({ rows: [row(1), row(2), row(3, 'chap_3x')] }),
    )
    expect(reclosed.expandedId).toBe('chap_3x')
  })

  it('leaves a redone close collapsed: the same id is already judged', () => {
    const closed = judge([
      input({ rows: [row(1), row(2)] }),
      input({ rows: [row(1), row(2), row(3)] }),
    ])
    const undone = nextExpandedChapter(closed, input({ rows: [row(1), row(2)] }))
    const redone = nextExpandedChapter(undone, input({ rows: [row(1), row(2), row(3)] }))
    expect(redone).toBe(undone)
    expect(redone.expandedId).toBeNull()
  })

  it('leaves an undone delete collapsed: the returning id was judged on arrival', () => {
    const rows = [row(4, 'chap_d'), row(11, 'chap_k'), row(7, 'chap_g')]
    const ready = judge([input({ rows })])
    const deleted = nextExpandedChapter(ready, input({ rows: [rows[0], rows[2]] }))
    expect(deleted).toBe(ready)
    expect(nextExpandedChapter(deleted, input({ rows })).expandedId).toBeNull()
  })

  it('keeps a deleted id judged while another close lands, so undoing both leaves it collapsed', () => {
    const rows = [row(1), row(2), row(3)]
    const state = judge([
      input({ rows }),
      input({ rows: [row(1), row(2)] }),
      input({ rows: [row(1), row(2), row(3, 'chap_3n')] }),
      input({ rows: [row(1), row(2)] }),
    ])
    expect(nextExpandedChapter(state, input({ rows })).expandedId).toBeNull()
  })
})

describe('useChapterExpansion', () => {
  it('expands a newcomer in the render its row arrives', () => {
    const seen: (string | null)[] = []
    const { rerender } = renderHook(
      (props: HookProps) => {
        const expansion = useChapterExpansion(props)
        seen.push(expansion.expandedId)
        return expansion
      },
      { initialProps: hookProps({ rows: [row(1)] }) },
    )
    expect(seen.at(-1)).toBeNull()

    const before = seen.length
    rerender(hookProps({ rows: [row(1), row(2)] }))
    expect(seen.slice(before)).not.toHaveLength(0)
    expect(seen.slice(before).every((id) => id === 'chap_2')).toBe(true)
  })

  it("takes a user's expand, a switch, and a collapse of the open card", () => {
    const rows = [row(1), row(2)]
    const { result } = renderHook(() => useChapterExpansion(hookProps({ rows })))
    expect(result.current.expandedId).toBeNull()

    act(() => result.current.toggle('chap_1'))
    expect(result.current.expandedId).toBe('chap_1')

    act(() => result.current.toggle('chap_2'))
    expect(result.current.expandedId).toBe('chap_2')

    act(() => result.current.toggle('chap_2'))
    expect(result.current.expandedId).toBeNull()
  })

  it('changes nothing while the guard holds the press', () => {
    const guard = vi.fn()
    const { result } = renderHook(() =>
      useChapterExpansion(hookProps({ rows: [row(1), row(2)], guard })),
    )
    act(() => result.current.toggle('chap_1'))
    expect(guard).toHaveBeenCalledTimes(1)
    expect(result.current.expandedId).toBeNull()
  })

  it('decides each held press as it proceeds, not as it was made', () => {
    const held: (() => void)[] = []
    const guard = (proceed: () => void) => {
      held.push(proceed)
    }
    const { result } = renderHook(() =>
      useChapterExpansion(hookProps({ rows: [row(1), row(2)], guard })),
    )
    act(() => result.current.toggle('chap_1'))
    act(() => result.current.toggle('chap_1'))
    expect(result.current.expandedId).toBeNull()

    act(() => held[0]())
    expect(result.current.expandedId).toBe('chap_1')
    // Made while the card was closed, it proceeds on the open card: a collapse.
    act(() => held[1]())
    expect(result.current.expandedId).toBeNull()
  })

  it("keeps a newcomer judgeable across a user's expand during its run", () => {
    const { result, rerender } = renderHook((props: HookProps) => useChapterExpansion(props), {
      initialProps: hookProps({ rows: [row(1), row(2)] }),
    })
    const during = hookProps({ rows: [row(1), row(2), row(3)], runInFlight: true })
    rerender(during)

    act(() => result.current.toggle('chap_1'))
    expect(result.current.expandedId).toBe('chap_1')

    rerender({ ...during, runInFlight: false })
    expect(result.current.expandedId).toBe('chap_3')
  })
})
