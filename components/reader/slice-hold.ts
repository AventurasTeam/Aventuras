// components/reader/slice-hold.ts
// Plain web React's helpers: runs inside the reader document's DOM bundle — never on Hermes.
import type { ChapterBreak, ChapterBreaks } from './chapter-breaks'
import type { WorldTimeDecoration } from './worldtime-decoration'

/** The slice-bearing props: what a held commit keeps of the slice it already shows. */
export type SliceFields<Row extends { id: string }> = {
  rows: Row[]
  worldTimeDecorations: Record<string, WorldTimeDecoration>
  chapterBreaks: ChapterBreaks
  closeHereEntryIds: Record<string, true>
  hasOlder: boolean
  hasNewer: boolean
  sliceKey: number
}

/**
 * How `incoming` differs from `shown` above the anchor row, the topmost row in the viewport:
 * `'changed'` when rows or chapter breaks above it, or the top skeleton, differ; `'anchorGone'`
 * when the incoming slice no longer holds the anchor.
 */
export type AboveChange = 'none' | 'changed' | 'anchorGone'

const sameBreak = (a: ChapterBreak | undefined, b: ChapterBreak | undefined) =>
  a === b || (a != null && b != null && a.number === b.number && a.timeLabel === b.timeLabel)

export function changeAbove<Row extends { id: string }>(
  shown: SliceFields<Row>,
  incoming: SliceFields<Row>,
  anchorId: string,
): AboveChange {
  const shownIndex = shown.rows.findIndex((row) => row.id === anchorId)
  const incomingIndex = incoming.rows.findIndex((row) => row.id === anchorId)
  if (shownIndex < 0 || incomingIndex < 0) return 'anchorGone'
  if (shownIndex !== incomingIndex || shown.hasOlder !== incoming.hasOlder) return 'changed'
  for (let i = 0; i < shownIndex; i += 1) {
    const id = shown.rows[i].id
    if (incoming.rows[i].id !== id) return 'changed'
    // A break hangs below its end row: the one under the row just above the anchor sits above it.
    if (!sameBreak(shown.chapterBreaks[id], incoming.chapterBreaks[id])) return 'changed'
  }
  return 'none'
}

/**
 * The slice rendered while a change above the anchor waits for scroll rest: the shown rows above
 * the anchor (with their latest content, and their own decorations, breaks and close-here marks
 * where the incoming slice dropped them), then the incoming slice from the anchor down. The top
 * skeleton and the key stay the shown ones. `anchorId` must be in both slices.
 */
export function composeHeld<Row extends { id: string }>(
  shown: SliceFields<Row>,
  incoming: SliceFields<Row>,
  anchorId: string,
): SliceFields<Row> {
  const shownIndex = shown.rows.findIndex((row) => row.id === anchorId)
  const incomingIndex = incoming.rows.findIndex((row) => row.id === anchorId)
  const incomingById = new Map(incoming.rows.map((row) => [row.id, row]))
  const above = shown.rows.slice(0, shownIndex).map((row) => incomingById.get(row.id) ?? row)
  const below = incoming.rows.slice(incomingIndex)
  const chapterBreaks: ChapterBreaks = {}
  for (const row of above) {
    const held = shown.chapterBreaks[row.id]
    if (held != null) chapterBreaks[row.id] = held
  }
  for (const row of below) {
    const live = incoming.chapterBreaks[row.id]
    if (live != null) chapterBreaks[row.id] = live
  }
  return {
    rows: [...above, ...below],
    worldTimeDecorations: { ...shown.worldTimeDecorations, ...incoming.worldTimeDecorations },
    chapterBreaks,
    closeHereEntryIds: heldCloseHereMarks(above, shown, incoming),
    hasOlder: shown.hasOlder,
    hasNewer: incoming.hasNewer,
    sliceKey: shown.sliceKey,
  }
}

/**
 * The whole shown slice, held while the incoming one has lost the anchor; its close-here marks
 * follow the incoming slice except on rows that slice no longer holds.
 */
export function sliceFieldsOf<Row extends { id: string }>(
  shown: SliceFields<Row>,
  incoming: SliceFields<Row>,
): SliceFields<Row> {
  return {
    rows: shown.rows,
    worldTimeDecorations: shown.worldTimeDecorations,
    chapterBreaks: shown.chapterBreaks,
    closeHereEntryIds: heldCloseHereMarks(shown.rows, shown, incoming),
    hasOlder: shown.hasOlder,
    hasNewer: shown.hasNewer,
    sliceKey: shown.sliceKey,
  }
}

// A mark the incoming slice dropped from a row it still holds is the row leaving the open region.
function heldCloseHereMarks<Row extends { id: string }>(
  heldRows: readonly Row[],
  shown: SliceFields<Row>,
  incoming: SliceFields<Row>,
): Record<string, true> {
  const incomingIds = new Set(incoming.rows.map((row) => row.id))
  const marks = { ...incoming.closeHereEntryIds }
  for (const row of heldRows) {
    if (!incomingIds.has(row.id) && shown.closeHereEntryIds[row.id] === true) marks[row.id] = true
  }
  return marks
}
