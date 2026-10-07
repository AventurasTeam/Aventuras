import { useLayoutEffect } from 'react'
import { useWindowDimensions } from 'react-native'

import { readerRailStore } from '@/lib/stores'

/** App root: any screen's width cross counts; a remount at the same width is no cross. */
export function RailViewportWatcher(): null {
  const { width } = useWindowDimensions()
  useLayoutEffect(() => {
    readerRailStore.dispatchDisplay({ type: 'resize', width })
  }, [width])
  return null
}
