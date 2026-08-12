import { KeyboardController } from 'react-native-keyboard-controller'

// Android's hide animation runs ~250ms. Past this a missing event is a lost
// event, and an overlay that never opens is worse than one that opens over a
// keyboard still on its way down.
const DISMISS_DEADLINE_MS = 400

/**
 * Resolves once the soft keyboard is down, immediately if it already was, and
 * always within {@link DISMISS_DEADLINE_MS} even if the platform never reports
 * the hide.
 *
 * Prefer this over `Keyboard.dismiss()` paired with a `keyboardDidHide`
 * listener. RN's `Keyboard.isVisible()` is a latch driven only by its own
 * show/hide events (`_currentlyShowing`), so one missed hide leaves it
 * stale-true for the rest of the session; a caller that gates on it then waits
 * for an event that will never arrive and its surface never opens at all.
 * `KeyboardController` tracks the same state off the bindings the root's
 * resize-mode claim already runs on, and short-circuits when nothing is up.
 *
 * Native only — callers must keep their own web branch, since there is no soft
 * keyboard to wait for there.
 */
/**
 * Whether a soft keyboard is currently up, per KeyboardController's own
 * bindings rather than RN's stale-prone latch. Lets a caller keep a synchronous
 * fast path and only pay {@link dismissKeyboard}'s await when there is
 * something to wait for.
 */
export function isKeyboardVisible(): boolean {
  return KeyboardController.isVisible()
}

export function dismissKeyboard(): Promise<void> {
  return new Promise((resolve) => {
    const deadline = setTimeout(resolve, DISMISS_DEADLINE_MS)
    void KeyboardController.dismiss().then(() => {
      clearTimeout(deadline)
      resolve()
    })
  })
}
