import { useLayoutEffect } from 'react'
import { useWindowDimensions } from 'react-native'

import { readerRailStore } from '@/lib/stores'

/** App root: any screen's width cross counts; a remount can't re-seed over a manual expand. */
export function RailViewportWatcher(): null {
  const { width } = useWindowDimensions()
  useLayoutEffect(() => {
    readerRailStore.seedViewport(width)
    readerRailStore.dispatchDisplay({ type: 'resize', width })
  }, [width])
  return null
}
