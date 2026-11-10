/** What a prose task reads at once when the model's window is unknown. */
export const UNKNOWN_WINDOW_PART_TOKENS = 32_000

/** A run of a chapter's entries the prose tasks read at once; `part` from 1. */
export type ChapterPartCut = {
  part: number
  startEntryId: string
  endEntryId: string
  tokens: number
}

/** An entry as the cut reads it; `kind` as `story_entries.kind` stores it. */
export type CutEntry = { id: string; kind: string; tokens: number }

type Unit = { startEntryId: string; endEntryId: string; tokens: number }

export function partTokenLimit(windowTokens: number | null): number {
  return windowTokens === null ? UNKNOWN_WINDOW_PART_TOKENS : Math.floor(windowTokens / 2)
}

// A player's turn joins the entry after it: that reply decides what the turn did.
function turnUnits(entries: readonly CutEntry[]): Unit[] {
  const units: Unit[] = []
  let pending: Unit | undefined
  for (const { id, kind, tokens } of entries) {
    const unit = pending ?? { startEntryId: id, endEntryId: id, tokens: 0 }
    unit.endEntryId = id
    unit.tokens += tokens
    if (kind === 'user_action') {
      pending = unit
      continue
    }
    pending = undefined
    units.push(unit)
  }
  if (pending !== undefined) units.push(pending)
  return units
}

/** Cuts `entries` (in position order) between turns, closing a part before a unit that would pass the limit. */
export function cutChapterParts(
  entries: readonly CutEntry[],
  windowTokens: number | null,
): ChapterPartCut[] {
  const limit = partTokenLimit(windowTokens)
  const parts: ChapterPartCut[] = []
  let open: ChapterPartCut | undefined
  for (const unit of turnUnits(entries)) {
    if (open !== undefined && open.tokens + unit.tokens <= limit) {
      open.endEntryId = unit.endEntryId
      open.tokens += unit.tokens
      continue
    }
    open = { part: parts.length + 1, ...unit }
    parts.push(open)
  }
  return parts
}
