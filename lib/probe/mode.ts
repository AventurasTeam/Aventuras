type CaptureMode = 'light' | 'deep'

let armed: CaptureMode = 'light'

/** Arms the next capture as deep. */
export function armDeepCapture(): void {
  armed = 'deep'
}

/**
 * One-shot: a deep capture runs ~100x the size of a light one, so a flag that
 * stayed armed would quietly fill the per-story cap with them. Reading disarms.
 */
export function takeNextCaptureMode(): CaptureMode {
  const mode = armed
  armed = 'light'
  return mode
}

// Test seam: the flag lives outside lib/stores, so resetAllStores cannot reach
// an arm a test left unconsumed.
export function __resetCaptureMode(): void {
  armed = 'light'
}
