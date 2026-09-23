import { useEffect, useState } from 'react'
import { Keyboard, Platform } from 'react-native'

/** Whether the soft keyboard is up. Always false on web, where no keyboard covers chrome. */
export function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (Platform.OS === 'web') return
    const show = Keyboard.addListener('keyboardDidShow', () => setShown(true))
    const hide = Keyboard.addListener('keyboardDidHide', () => setShown(false))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  return shown
}
