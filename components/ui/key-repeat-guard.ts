import { Platform } from 'react-native'

const ACTIVATING_KEYS = new Set(['Enter', ' '])

/**
 * Drops, for the whole document, an Enter or Space auto-repeat that lands on another element
 * than the press began on. A keydown that moves focus hands the key's repeats to the new target,
 * where the browser and RN-Web's PressResponder act on each one
 * (lessons-learned/keydown-focus-move-hands-off-key-repeat.md). Returns the unregister.
 */
export function registerKeyRepeatGuard(): () => void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return () => {}
  // Keyed on the press itself, not on a matching keyup: a release lost to another window must
  // not leave the next press of the key dropped.
  const pressedOn = new Map<string, EventTarget | null>()
  const onKeyDown = (event: KeyboardEvent) => {
    if (!ACTIVATING_KEYS.has(event.key)) return
    if (!event.repeat) {
      pressedOn.set(event.key, event.target)
      return
    }
    if (pressedOn.get(event.key) === event.target) return
    event.preventDefault()
    event.stopPropagation()
  }
  const onKeyUp = (event: KeyboardEvent) => {
    pressedOn.delete(event.key)
  }
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('keyup', onKeyUp, true)
  return () => {
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('keyup', onKeyUp, true)
  }
}
