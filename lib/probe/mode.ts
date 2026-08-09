type CaptureMode = 'light' | 'deep'

let armed: CaptureMode = 'light'

/** Arms the next capture as deep. */
export function armDeepCapture(): void {
  armed = 'deep'
}

/** What the next capture would write. Reading does not spend the arm. */
export function peekCaptureMode(): CaptureMode {
  return armed
}

/**
 * One-shot: a deep capture costs ~30x a light one to write and 40-80x to store
 * (probe.md → Capture cost), so a flag that stayed armed would quietly fill the
 * per-story cap with them. Spent only by a capture that actually landed — a
 * gated turn or a failed write leaves the arm loaded, because "I armed deep and
 * got a light capture" is the symptom either one would otherwise produce.
 */
export function spendCaptureMode(): void {
  armed = 'light'
}

// Test seam: the flag lives outside lib/stores, so resetAllStores cannot reach
// an arm a test left unconsumed.
export function __resetCaptureMode(): void {
  armed = 'light'
}
