type CaptureMode = 'light' | 'deep'

/** A capture's claim on the arm it read, redeemed by commitCaptureMode. */
export type CaptureReservation = { readonly mode: CaptureMode; readonly armId: number }

let armed: CaptureMode = 'light'
let armId = 0

/** Arms the next capture as deep. */
export function armDeepCapture(): void {
  armed = 'deep'
  armId += 1
}

/** What the next capture would write. Reading does not spend the arm. */
export function peekCaptureMode(): CaptureMode {
  return armed
}

/** The mode one capture writes, tagged with the arm that produced it. */
export function reserveCaptureMode(): CaptureReservation {
  return { mode: armed, armId }
}

/**
 * One-shot: a deep capture costs ~30x a light one to write and 40-80x to store
 * (probe.md → Capture cost), so a flag that stayed armed would quietly fill the
 * per-story cap with them. Spends only the arm the reservation read — a capture
 * awaits its write, and an arm raised inside that window belongs to the next
 * capture, so an unconditional clear would swallow it.
 */
export function commitCaptureMode(reservation: CaptureReservation): void {
  if (reservation.armId !== armId) return
  armed = 'light'
}

// Test seam: the flag lives outside lib/stores, so resetAllStores cannot reach
// an arm a test left unconsumed. Bumps rather than zeroes the id, so a
// reservation taken before the reset cannot commit against the state after it.
export function __resetCaptureMode(): void {
  armed = 'light'
  armId += 1
}
