import { useEffect } from 'react'
import { Platform } from 'react-native'

const BACK_BUTTON = 3
const FORWARD_BUTTON = 4

/**
 * While `active`, the mouse's Back and Forward buttons don't navigate (web; a no-op elsewhere):
 * Electron pops history on their mouseup, and no `usePreventRemove` sees expo-router's reset.
 */
export function useInertMouseBack(active: boolean): void {
  useEffect(() => {
    if (!active || Platform.OS !== 'web' || typeof window === 'undefined') return undefined
    const onMouseUp = (event: MouseEvent) => {
      if (event.button === BACK_BUTTON || event.button === FORWARD_BUTTON) event.preventDefault()
    }
    window.addEventListener('mouseup', onMouseUp, true)
    return () => window.removeEventListener('mouseup', onMouseUp, true)
  }, [active])
}
