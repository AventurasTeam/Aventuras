import { resolveHeadTurn, type TurnEntry } from '@/lib/head-turn'

/**
 * The head turn's entries: the narrative tail and, when the tail answers one, its
 * `user_action`. The same membership `updateStoryEntryContent` lets through a pass.
 * Empty unless the window's last turn is the tail the host named, as for
 * `resolveSaveAndRegenTurn`: a window short of the live edge describes another turn.
 */
export function headTurnIdsOf(
  rows: readonly TurnEntry[],
  tailEntryId: string | null,
): ReadonlySet<string> {
  const head = resolveHeadTurn(rows)
  if (head == null || head.tail.id !== tailEntryId) return new Set()
  return new Set(head.origin == null ? [head.tail.id] : [head.tail.id, head.origin.id])
}

/**
 * Head reversals pass through a pass or a close (principles.md → Edit restrictions during
 * in-flight generation): ↻ and × on every row, and the pencil on the head turn alone, follow
 * `headReversalBlocked`. Any other row's pencil keeps the whole gate.
 */
export function rowReversalFlags(args: {
  rowId: string
  headTurnIds: ReadonlySet<string>
  editBlocked: boolean
  headReversalBlocked: boolean
}): { editDisabled: boolean; reversalDisabled: boolean } {
  return {
    editDisabled: args.headTurnIds.has(args.rowId) ? args.headReversalBlocked : args.editBlocked,
    reversalDisabled: args.headReversalBlocked,
  }
}
