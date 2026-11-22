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
 * The row controls' tooltip. An `interruptible` gate disables only what the pill's run holds; a
 * `closed` one holds the head reversals too, so it names the run they can't pass through.
 */
export function rowGateReason(
  editGate: EditGate,
  reasons: { gate: string | undefined; headReversal: string | undefined },
): string | undefined {
  if (editGate === 'open') return undefined
  return editGate === 'closed' ? reasons.headReversal : reasons.gate
}

/**
 * principles.md → Edit restrictions during in-flight generation: through an `interruptible` gate,
 * ↻ and × on every row and the head turn's pencil stay live; any other pencil keeps the whole gate.
 * A re-run holds a stamped row's ↻ and × whatever the gate lets through.
 */
export function rowReversalFlags(args: {
  rowId: string
  headTurnIds: ReadonlySet<string>
  editGate: EditGate
  /** `rerunHoldsReversal` for this row's entry: a re-run runs and the entry has a chapter id. */
  reversalHeld?: boolean
}): { editDisabled: boolean; reversalDisabled: boolean } {
  const closed = args.editGate === 'closed'
  return {
    editDisabled: args.headTurnIds.has(args.rowId) ? closed : args.editGate !== 'open',
    reversalDisabled: closed || args.reversalHeld === true,
  }
}

/** The reader's Undo: a re-run refuses every CTRL-Z, so Undo holds then, naming the pill's run
 * where no run blocks head reversals. */
export function undoHold(args: {
  headReversalBlocked: boolean
  rerunRunning: boolean
  reasons: { gate: string | undefined; headReversal: string | undefined }
}): { blocked: boolean; reason: string | undefined } {
  if (args.headReversalBlocked) return { blocked: true, reason: args.reasons.headReversal }
  if (args.rerunRunning) return { blocked: true, reason: args.reasons.gate }
  return { blocked: false, reason: args.reasons.headReversal }
}

/**
 * reader-composer.md → Inline edit session: the leave guard's Save is the editor's own, held by
 * the same gate with the same reason, so a head-turn edit stays savable through a pass.
 */
export function inlineEditSaveGate(args: {
  entryId: string | null
  headTurnIds: ReadonlySet<string>
  editGate: EditGate
  reasons: { gate: string | undefined; headReversal: string | undefined }
}): { disabled: boolean; reason: string | undefined } {
  if (args.entryId == null) return { disabled: false, reason: undefined }
  const { editDisabled } = rowReversalFlags({
    rowId: args.entryId,
    headTurnIds: args.headTurnIds,
    editGate: args.editGate,
  })
  return {
    disabled: editDisabled,
    reason: editDisabled ? rowGateReason(args.editGate, args.reasons) : undefined,
  }
}
