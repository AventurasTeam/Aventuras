import { useCallback, useMemo } from 'react'

import { useRowSessionGuard } from '@/hooks/use-row-session-guard'
import type { ChapterSaveResult } from '@/lib/actions'
import { chapterDraftFrom, type ChapterDraft } from '@/lib/chapters'
import type { StoreChapter } from '@/lib/stores'

import { useChapterExpansion } from './chapter-expansion'
import { useChapterRowSession, type ChapterRowSession } from './use-chapter-row-session'

// No field renders while no card is open, so no Save can reach this; it writes nothing.
const NO_CHAPTER_OPEN: ChapterSaveResult = {
  status: 'rejected',
  reason: 'no chapter open',
  code: 'failed',
}

export type TimelineEditingOptions = {
  /** `useColdOpenStory(...) != null`: chaptersStore is hydrated for the branch. */
  ready: boolean
  /** The branch's closed chapters, as the cards show them. */
  rows: readonly StoreChapter[]
  /** `useStoryGenerationGate().editBlocked`: a landing close waits for its run to end. */
  runInFlight: boolean
  save: (row: StoreChapter, draft: ChapterDraft) => Promise<ChapterSaveResult>
  onSaved: () => void
  onRejected: (reason: string) => void
}

export type TimelineEditing = {
  expandedId: string | null
  /** The route's one session, keyed by the expanded card. */
  session: ChapterRowSession
  /** A card head's press: expands it, or collapses it when open; through the leave guard. */
  toggle: (id: string) => void
  guard: (proceed: () => void) => void
  navigateGuarded: (path: string) => void
}

/** The Timeline's editing state: the leave guard, which card is open, and its save session. */
export function useTimelineEditing({
  ready,
  rows,
  runInFlight,
  save,
  onSaved,
  onRejected,
}: TimelineEditingOptions): TimelineEditing {
  const { onSession, guard, navigateGuarded, dirty } = useRowSessionGuard()
  // Ahead of the session: its key is the expanded id, which must change in the same render.
  const { expandedId, setExpanded } = useChapterExpansion({ ready, rows, runInFlight, dirty })
  const expandedRow = rows.find((row) => row.id === expandedId) ?? null
  const values = useMemo(() => chapterDraftFrom(expandedRow), [expandedRow])
  const onSave = useCallback(
    (draft: ChapterDraft): Promise<ChapterSaveResult> =>
      expandedRow == null ? Promise.resolve(NO_CHAPTER_OPEN) : save(expandedRow, draft),
    [expandedRow, save],
  )
  const session = useChapterRowSession({
    rowId: expandedId,
    values,
    onSave,
    onSaved,
    onRejected,
    onSession,
  })
  const toggle = useCallback(
    (id: string) => guard(() => setExpanded(id === expandedId ? null : id)),
    [guard, setExpanded, expandedId],
  )
  return { expandedId, session, toggle, guard, navigateGuarded }
}
