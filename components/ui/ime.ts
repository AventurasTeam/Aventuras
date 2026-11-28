import type { TextInputKeyPressEvent } from 'react-native'

// RN-Web's own submit guard reads both signals; 229 is the key code an IME's confirming Enter can
// carry with isComposing already false.
const IME_KEY_CODE = 229

/** Whether a key press belongs to an IME composition, so its Enter confirms text, not a submit. */
export function isComposing({ nativeEvent }: TextInputKeyPressEvent): boolean {
  return (
    ('isComposing' in nativeEvent && nativeEvent.isComposing === true) ||
    ('keyCode' in nativeEvent && nativeEvent.keyCode === IME_KEY_CODE)
  )
}
