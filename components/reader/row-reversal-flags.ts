import { resolveHeadTurn, type TurnEntry } from '@/lib/head-turn'

import type { EditGate } from './reader-document-types'

/**
 * The head turn's entries: the narrative tail plus the `user_action` it answers, if any — the
 * membership `updateStoryEntryContent` lets through a pass. Empty unless the window's last turn
 * is the host-named tail (as `resolveSaveAndRegenTurn`): short of the live edge it's another turn.
 */
export function headTurnIdsOf(
  rows: readonly TurnEntry[],
  tailEntryId: string | null,
): ReadonlySet<string> {
  const head = resolveHeadTurn(rows)
  if (head == null || head.tail.id !== tailEntryId) return new Set()
  return new Set(head.origin == null ? [head.tail.id] : [head.tail.id, head.origin.id])
}

/** The host's two gates as one; the head reversals' gate implies the whole gate, so it closes all. */
export function editGateOf(gates: {
  editBlocked: boolean
  headReversalBlocked: boolean
}): EditGate {
  if (gates.headReversalBlocked) return 'closed'
  return gates.editBlocked ? 'interruptible' : 'open'
}

/**
 * Head reversals pass through a pass or a close (principles.md → Edit restrictions during
 * in-flight generation): ↻ and × on every row, and the pencil on the head turn alone, stay live
 * through an `interruptible` gate. Any other row's pencil keeps the whole gate.
 */
export function rowReversalFlags(args: {
  rowId: string
  headTurnIds: ReadonlySet<string>
  editGate: EditGate
}): { editDisabled: boolean; reversalDisabled: boolean } {
  const closed = args.editGate === 'closed'
  return {
    editDisabled: args.headTurnIds.has(args.rowId) ? closed : args.editGate !== 'open',
    reversalDisabled: closed,
  }
}
