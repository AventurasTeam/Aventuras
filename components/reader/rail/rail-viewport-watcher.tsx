import { useLayoutEffect } from 'react'
import { useWindowDimensions } from 'react-native'

import { readerRailStore } from '@/lib/stores'

/**
 * Feeds window widths to the rail's display state from the app root, so a threshold cross on any
 * screen counts and a reader remount never re-seeds over a manual expand.
 */
export function RailViewportWatcher(): null {
  const { width } = useWindowDimensions()
  useLayoutEffect(() => {
    readerRailStore.seedViewport(width)
    readerRailStore.dispatchDisplay({ type: 'resize', width })
  }, [width])
  return null
}
