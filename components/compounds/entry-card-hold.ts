/** One action control's disabled state and the reason it shows. */
export type HeldControl = { disabled: boolean; reason: string | undefined }

/**
 * Edit-mode focus elsewhere holds a control, but the run gate outranks it: cancelling the edit
 * wouldn't free a control the gate holds too, so that control keeps the gate's reason.
 */
export function heldControl(
  gated: boolean | undefined,
  held: boolean | undefined,
  reasons: { gate: string | undefined; held: string | undefined },
): HeldControl {
  if (gated === true) return { disabled: true, reason: reasons.gate }
  if (held === true) return { disabled: true, reason: reasons.held }
  return { disabled: false, reason: reasons.gate }
}

/**
 * A control that starts a turn (↻, Save & regenerate, a turn failure's Retry): the gate's reason
 * first, then the turn-start refusal, then edit focus elsewhere, which cancelling the edit frees.
 */
export function turnStartControl(
  gated: boolean | undefined,
  held: boolean | undefined,
  reasons: { gate: string | undefined; turnStart: string | undefined; held: string | undefined },
): HeldControl {
  if (gated === true) return { disabled: true, reason: reasons.gate }
  if (reasons.turnStart != null) return { disabled: true, reason: reasons.turnStart }
  return heldControl(false, held, reasons)
}
