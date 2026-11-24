import { heldControl, type HeldControl } from '@/components/compounds/entry-card-hold'
import { t } from '@/lib/i18n'

import { undoHold } from './row-reversal-flags'

type Control = HeldControl

/**
 * The menu's Undo and Redo gates; a loading branch refuses both, naming the load first. Undo of
 * the turn is a head reversal, live through a pass (the action `gated`-refuses other targets, and
 * all while a re-run runs); Redo never is one. An open editor holds both, the gate's reason first.
 */
export function readerUndoRedoGates(input: {
  hydrated: boolean
  headReversalBlocked: boolean
  rerunRunning: boolean
  actionsBlocked: boolean
  editorOpen: boolean
  reasons: { gate: string | undefined; headReversal: string | undefined }
}): { undo: Control; redo: Control } {
  if (!input.hydrated) {
    const loading: Control = { disabled: true, reason: t('reader:hydrationLoading') }
    return { undo: loading, redo: loading }
  }
  const held = t('reader:editFocus.held')
  const undoGate = undoHold({
    headReversalBlocked: input.headReversalBlocked,
    rerunRunning: input.rerunRunning,
    reasons: input.reasons,
  })
  return {
    undo: heldControl(undoGate.blocked, input.editorOpen, { gate: undoGate.reason, held }),
    redo: heldControl(input.actionsBlocked, input.editorOpen, { gate: input.reasons.gate, held }),
  }
}
