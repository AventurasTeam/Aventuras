/**
 * Swipe gesture detection utilities for mobile touch interactions.
 * Implements a Svelte action for easy attachment to any element.
 */

export type SwipeDirection = 'left' | 'right' | 'up' | 'down'

export interface SwipeEvent {
  direction: SwipeDirection
  distance: number
  velocity: number
  startX: number
  startY: number
  endX: number
  endY: number
}

export interface SwipeOptions {
  /** Minimum distance in pixels to trigger a swipe (default: 50) */
  threshold?: number
  /** Maximum time in ms for the swipe gesture (default: 300) */
  timeout?: number
  /** Callback when swipe is detected */
  onSwipe?: (event: SwipeEvent) => void
  /** Callback for specific directions */
  onSwipeLeft?: (event: SwipeEvent) => void
  onSwipeRight?: (event: SwipeEvent) => void
  onSwipeUp?: (event: SwipeEvent) => void
  onSwipeDown?: (event: SwipeEvent) => void
  /** Whether to prevent default touch behavior (default: false) */
  preventDefault?: boolean
}

/** Text entry owns its own horizontal drags: a caret or a selection is not a swipe. */
function startsInTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return !!target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
}

interface TouchState {
  startX: number
  startY: number
  startTime: number
  tracking: boolean
}

/**
 * Svelte action for swipe gesture detection.
 * Usage: <div use:swipe={{ onSwipeLeft: () => {}, threshold: 50 }}>
 */
export function swipe(node: HTMLElement, options: SwipeOptions = {}) {
  const { threshold = 50, timeout = 300, preventDefault = false } = options

  let state: TouchState = {
    startX: 0,
    startY: 0,
    startTime: 0,
    tracking: false,
  }

  let currentOptions = options

  function handleTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return
    if (startsInTextEntry(e.target)) return

    const touch = e.touches[0]
    state = {
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: Date.now(),
      tracking: true,
    }

    if (preventDefault) {
      e.preventDefault()
    }
  }

  function handleTouchMove(e: TouchEvent) {
    if (!state.tracking) return

    // Optionally prevent scrolling while swiping
    if (preventDefault) {
      e.preventDefault()
    }
  }

  function handleTouchEnd(e: TouchEvent) {
    if (!state.tracking) return
    state.tracking = false

    const touch = e.changedTouches[0]
    const endX = touch.clientX
    const endY = touch.clientY
    const endTime = Date.now()

    const deltaX = endX - state.startX
    const deltaY = endY - state.startY
    const deltaTime = endTime - state.startTime

    // Check if gesture was too slow
    if (deltaTime > (currentOptions.timeout ?? timeout)) return

    const absX = Math.abs(deltaX)
    const absY = Math.abs(deltaY)

    // Check if swipe meets threshold
    const minThreshold = currentOptions.threshold ?? threshold
    if (absX < minThreshold && absY < minThreshold) return

    // Determine direction (favor the axis with more movement)
    let direction: SwipeDirection
    if (absX > absY) {
      direction = deltaX > 0 ? 'right' : 'left'
    } else {
      direction = deltaY > 0 ? 'down' : 'up'
    }

    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
    const velocity = distance / deltaTime

    const swipeEvent: SwipeEvent = {
      direction,
      distance,
      velocity,
      startX: state.startX,
      startY: state.startY,
      endX,
      endY,
    }

    // Call appropriate callbacks
    currentOptions.onSwipe?.(swipeEvent)

    switch (direction) {
      case 'left':
        currentOptions.onSwipeLeft?.(swipeEvent)
        break
      case 'right':
        currentOptions.onSwipeRight?.(swipeEvent)
        break
      case 'up':
        currentOptions.onSwipeUp?.(swipeEvent)
        break
      case 'down':
        currentOptions.onSwipeDown?.(swipeEvent)
        break
    }
  }

  function handleTouchCancel() {
    state.tracking = false
  }

  // Add event listeners with passive option for better scroll performance
  node.addEventListener('touchstart', handleTouchStart, { passive: !preventDefault })
  node.addEventListener('touchmove', handleTouchMove, { passive: !preventDefault })
  node.addEventListener('touchend', handleTouchEnd, { passive: true })
  node.addEventListener('touchcancel', handleTouchCancel, { passive: true })

  return {
    update(newOptions: SwipeOptions) {
      currentOptions = newOptions
    },
    destroy() {
      node.removeEventListener('touchstart', handleTouchStart)
      node.removeEventListener('touchmove', handleTouchMove)
      node.removeEventListener('touchend', handleTouchEnd)
      node.removeEventListener('touchcancel', handleTouchCancel)
    },
  }
}

/**
 * Helper to detect if the device supports touch.
 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0
}

/**
 * Helper to detect if we're on a mobile device.
 */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
}
