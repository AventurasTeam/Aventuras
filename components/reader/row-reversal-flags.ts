import { headTurnEntries, resolveHeadTurn, type TurnEntry } from '@/lib/head-turn'

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
  return new Set(headTurnEntries(head).map((entry) => entry.id))
}

/** The host's two gates as one; the head-reversal gate implies the whole gate, so it closes all. */
export function editGateOf(gates: {
  editBlocked: boolean
  headReversalBlocked: boolean
}): EditGate {
  if (gates.headReversalBlocked) return 'closed'
  return gates.editBlocked ? 'interruptible' : 'open'
}

/**
 * principles.md → Edit restrictions during in-flight generation: through an `interruptible` gate,
 * ↻ and × on every row and the head turn's pencil stay live; any other pencil keeps the whole gate.
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
