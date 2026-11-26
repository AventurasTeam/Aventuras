import { useRouter } from 'expo-router'
import { useEffect } from 'react'
import { Platform } from 'react-native'

import { blockingOverlaysStore } from '@/lib/stores'

import { isMouseBackInert } from './use-inert-mouse-back'

const BACK_BUTTON = 3
const FORWARD_BUTTON = 4

/**
 * The mouse's Back and Forward, on web. Electron pops history on their mouseup, and expo-router
 * answers the pop with a reset at the root that no `usePreventRemove` sees, so both are
 * cancelled: Back takes the app's own guarded back instead, unless an overlay is up or a pending
 * step holds it, and Forward does nothing.
 */
export function useMouseHistoryButtons(): void {
  const router = useRouter()
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined
    const onMouseUp = (event: MouseEvent) => {
      if (event.button !== BACK_BUTTON && event.button !== FORWARD_BUTTON) return
      event.preventDefault()
      if (event.button !== BACK_BUTTON) return
      if (isMouseBackInert() || blockingOverlaysStore.isBlocked()) return
      if (router.canGoBack()) router.back()
    }
    window.addEventListener('mouseup', onMouseUp, true)
    return () => window.removeEventListener('mouseup', onMouseUp, true)
  }, [router])
}
