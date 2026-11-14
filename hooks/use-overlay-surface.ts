import { useFocusEffect } from 'expo-router'
import { useCallback } from 'react'

import { chapterOverlaysStore } from '@/lib/stores'

import { useSurfaceNavigate } from './use-surface-navigate'

type LeaveGuard = (proceed: () => void) => void

// A module constant, so a route with nothing to guard doesn't re-register on every render.
const PROCEED_AT_ONCE: LeaveGuard = (proceed) => proceed()

/**
 * Registers the focused route as the surface the root overlays press through (C7): its leave
 * guard, and its own navigate, which reuses this Stack's screens where the root host's would push
 * a second one. On focus, not mount: a Stack keeps pushed-under screens mounted.
 */
export function useOverlaySurface(guard: LeaveGuard = PROCEED_AT_ONCE): void {
  const navigate = useSurfaceNavigate()
  useFocusEffect(
    useCallback(() => chapterOverlaysStore.registerSurface({ guard, navigate }), [guard, navigate]),
  )
}
