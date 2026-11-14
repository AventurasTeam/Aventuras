import { Platform } from 'react-native'

/**
 * Enter for a `role="link"` Pressable or Text on web. RN-Web's PressResponder presses a link on
 * click only, never on a key, and with no `href` the browser doesn't either. Typed `object` to
 * spread past RN's types, which omit onKeyDown.
 */
export function webEnterProps(onPress: (() => void) | undefined): object | undefined {
  if (Platform.OS !== 'web' || onPress == null) return undefined
  return {
    onKeyDown: (event: { key: string; preventDefault(): void }) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      onPress()
    },
  }
}
