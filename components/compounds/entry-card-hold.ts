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
