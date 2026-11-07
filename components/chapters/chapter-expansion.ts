import { useCallback, useState } from 'react'

export type ChapterExpansionState = Readonly<{
  expandedId: string | null
  /** Ids already judged, so never expanded again; null until the route is ready. */
  judged: ReadonlySet<string> | null
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
  judged: null,
}

function newestUnjudged(
  rows: readonly ExpansionRow[],
  judged: ReadonlySet<string>,
): ExpansionRow | null {
  let newest: ExpansionRow | null = null
  for (const row of rows) {
    if (judged.has(row.id)) continue
    if (newest == null || row.sequenceNumber > newest.sequenceNumber) newest = row
  }
  return newest
}

/**
 * The expanded card after `input`: the first ready rows are judged, expanding nothing; an unjudged
 * row is judged once its run ends, the newest expanding if no card is dirty. `state` if unchanged.
 */
export function nextExpandedChapter(
  state: ChapterExpansionState,
  input: ChapterExpansionInput,
): ChapterExpansionState {
  if (!input.ready) return state
  const judged = state.judged ?? new Set(input.rows.map((row) => row.id))
  const kept = state.expandedId != null && input.rows.some((row) => row.id === state.expandedId)
  let expandedId = kept ? state.expandedId : null
  let nextJudged = judged
  if (!input.runInFlight) {
    const newest = newestUnjudged(input.rows, judged)
    if (newest != null) {
      // Ids that leave stay judged: a redo or an undone delete brings one back collapsed.
      nextJudged = new Set([...judged, ...input.rows.map((row) => row.id)])
      if (!input.dirty) expandedId = newest.id
    }
  }
  if (expandedId === state.expandedId && nextJudged === state.judged) return state
  return { expandedId, judged: nextJudged }
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
