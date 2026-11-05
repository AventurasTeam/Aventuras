import {
  useScrollEventsHandlersDefault,
  type ScrollEventsHandlersHookType,
} from '@gorhom/bottom-sheet'
import { createContext, useCallback, useContext } from 'react'
import type { NativeScrollEvent } from 'react-native'
import type { SharedValue } from 'react-native-reanimated'

/** gorhom's per-scrollable handler context: where a locked scrollable is held. */
type LockContext = { initialContentOffsetY?: number; shouldLockInitialPosition?: boolean }
type Handler = (event: NativeScrollEvent, context: LockContext) => void

/** The offset a pinned list is held at while its Sheet moves; negative once unpinned. */
export const PinnedEndContext = createContext<SharedValue<number> | null>(null)

/**
 * gorhom holds a Sheet's scrollable until the Sheet is fully up, snapping each scroll back to the
 * top; a pinned list is held at its end instead, so the Sheet rises on its last rows.
 */
export const useEndLockedScrollHandlers: ScrollEventsHandlersHookType = (ref, contentOffsetY) => {
  const defaults = useScrollEventsHandlersDefault(ref, contentOffsetY)
  const handleOnScroll = defaults.handleOnScroll as unknown as Handler
  const pinnedEnd = useContext(PinnedEndContext)
  // gorhom's end-drag and momentum handlers lock from the same context, so the end holds there too.
  const onScroll = useCallback<Handler>(
    (event, context) => {
      'worklet'
      const end = pinnedEnd?.value ?? -1
      if (end >= 0) {
        context.shouldLockInitialPosition = true
        context.initialContentOffsetY = end
      }
      handleOnScroll(event, context)
    },
    [handleOnScroll, pinnedEnd],
  )
  return { ...defaults, handleOnScroll: onScroll } as ReturnType<ScrollEventsHandlersHookType>
}
