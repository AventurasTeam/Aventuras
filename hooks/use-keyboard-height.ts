import * as React from 'react'
import { Keyboard, Platform } from 'react-native'

/**
 * Tracks the on-screen keyboard's height. Returns 0 when keyboard
 * is hidden or on web (no soft keyboard).
 *
 * Used to extend a scrollable surface's bottom inset so content
 * pinned near the bottom — last list row, footer button — can be
 * scrolled into view above the keyboard rather than being covered
 * by it.
 *
 * iOS: subscribes to `keyboardWillShow` / `keyboardWillHide` so
 * the height tracks the keyboard animation start, enabling smooth
 * coordinated layout. Android: only `keyboardDidShow` /
 * `keyboardDidHide` are reliably available, so the inset shifts
 * after the keyboard finishes its animation. Acceptable on Android
 * since `windowSoftInputMode=adjustResize` (the default for Expo)
 * already handles the bulk of the avoidance natively.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = React.useState(0)

  React.useEffect(() => {
    if (Platform.OS === 'web') return undefined
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const showSub = Keyboard.addListener(showEvent, (e) => {
      setHeight(e.endCoordinates.height)
    })
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setHeight(0)
    })
    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [])

  return height
}
