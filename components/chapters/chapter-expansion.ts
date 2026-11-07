import { useCallback, useState } from 'react'

export type ChapterExpansionState = Readonly<{
  expandedId: string | null
  /** Highest sequenceNumber judged so far; null until the route is ready. */
  baseline: number | null
}>

export type ChapterExpansionInput = Readonly<{
  /** `useColdOpenStory(...) != null`: chaptersStore is hydrated for the branch. */
  ready: boolean
  /** The branch's rows only. */
  rows: readonly { id: string; sequenceNumber: number }[]
  /** `useStoryGenerationGate().editBlocked`. */
  runInFlight: boolean
  /** The route's session is dirty: `useRowSessionGuard().dirty`. */
  dirty: boolean
}>

type ExpansionRow = ChapterExpansionInput['rows'][number]

export const INITIAL_CHAPTER_EXPANSION: ChapterExpansionState = {
  expandedId: null,
  baseline: null,
}

function highestSequence(rows: readonly ExpansionRow[]): number {
  let highest = 0
  for (const row of rows) highest = Math.max(highest, row.sequenceNumber)
  return highest
}

function newestAbove(rows: readonly ExpansionRow[], floor: number): ExpansionRow | null {
  let newest: ExpansionRow | null = null
  for (const row of rows) {
    if (row.sequenceNumber <= floor) continue
    if (newest == null || row.sequenceNumber > newest.sequenceNumber) newest = row
  }
  return newest
}

/**
 * The expanded card after `input`. The first ready rows set the baseline and expand nothing; a row
 * above it is judged once its run has ended, expanding only with no card dirty, and the baseline
 * rises past it either way. Returns `state` itself when nothing changes.
 */
export function nextExpandedChapter(
  state: ChapterExpansionState,
  input: ChapterExpansionInput,
): ChapterExpansionState {
  if (!input.ready) return state
  const baseline = state.baseline ?? highestSequence(input.rows)
  const kept = state.expandedId != null && input.rows.some((row) => row.id === state.expandedId)
  let expandedId = kept ? state.expandedId : null
  let nextBaseline = baseline
  if (!input.runInFlight) {
    const newest = newestAbove(input.rows, baseline)
    if (newest != null) {
      nextBaseline = newest.sequenceNumber
      if (!input.dirty) expandedId = newest.id
    }
  }
  if (expandedId === state.expandedId && nextBaseline === state.baseline) return state
  return { expandedId, baseline: nextBaseline }
}

export function useChapterExpansion(input: ChapterExpansionInput): {
  expandedId: string | null
  /** A user's expand (an id) or collapse (null); the caller guards it. */
  setExpanded: (id: string | null) => void
} {
  const [state, setState] = useState(INITIAL_CHAPTER_EXPANSION)
  // In render, not an effect: the expanded card and its session key change in one commit.
  const next = nextExpandedChapter(state, input)
  if (next !== state) setState(next)
  const setExpanded = useCallback((id: string | null) => {
    setState((prev) => (prev.expandedId === id ? prev : { ...prev, expandedId: id }))
  }, [])
  return { expandedId: next.expandedId, setExpanded }
}
