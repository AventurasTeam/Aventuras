import { useRowSessionGuard } from '@/hooks/use-row-session-guard'
import type { ChapterSaveResult } from '@/lib/actions'
import type { ChapterDraft, ChapterDraftRow } from '@/lib/chapters'
import { closingChapterId } from '@/lib/pipeline'
import { generationStore, type StoreChapter } from '@/lib/stores'

import { useChapterExpansion } from './chapter-expansion'
import { useChapterRowSession, type ChapterRowSession } from './use-chapter-row-session'

export type TimelineEditingOptions = {
  /** `useColdOpenStory(...) != null`: chaptersStore is hydrated for the branch. */
  ready: boolean
  /** The branch whose close, if one is running, holds its chapter back from the first judging. */
  branchId: string
  /** The branch's closed chapters, as the cards show them. */
  rows: readonly StoreChapter[]
  /** `useStoryGenerationGate().editBlocked`: a landing close waits for its run to end. */
  runInFlight: boolean
  save: (row: ChapterDraftRow, draft: ChapterDraft) => Promise<ChapterSaveResult>
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
  branchId,
  rows,
  runInFlight,
  save,
  onSaved,
  onRejected,
}: TimelineEditingOptions): TimelineEditing {
  const { onSession, guard, navigateGuarded, dirty } = useRowSessionGuard()
  const closingId = generationStore.useGeneration((s) => closingChapterId(s.txState, branchId))
  // Ahead of the session: its key is the expanded id, which must change in the same render.
  const { expandedId, toggle } = useChapterExpansion({
    ready,
    rows,
    runInFlight,
    closingId,
    dirty,
    guard,
  })
  const session = useChapterRowSession({
    row: rows.find((row) => row.id === expandedId) ?? null,
    onSave: save,
    onSaved,
    onRejected,
    onSession,
  })
  return { expandedId, session, toggle, guard, navigateGuarded }
}
