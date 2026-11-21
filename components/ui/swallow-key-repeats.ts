import { Platform } from 'react-native'

/**
 * Drops a held key's remaining auto-repeat, up to its release. A keydown that moves focus hands
 * the repeats to the new target, and a button there clicks on each
 * (lessons-learned/keydown-focus-move-hands-off-key-repeat.md).
 */
export function swallowKeyRepeats(key: string): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return
  // Every keydown of the key before its release is a repeat; the flag isn't checked, so a
  // synthetic repeat (user-event's) is dropped too.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== key) return
    event.preventDefault()
    event.stopPropagation()
  }
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key !== key) return
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('keyup', onKeyUp, true)
  }
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('keyup', onKeyUp, true)
}
