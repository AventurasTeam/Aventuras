import type { RailPeek } from './categories'

// reader-composer.md → State model. The viewport acts only on a cross, never as a standing
// constraint, so a manual expand in a small window holds until the next downward cross.
export const RAIL_COLLAPSE_BELOW_PX = 900
export const RAIL_RESTORE_ABOVE_PX = 980

export type RailDisplayState = {
  /** The width the last resize reported; a cross is judged against it. */
  readonly lastWidth: number
  /** Viewport-forced collapse; overrides the manual preference without replacing it. */
  readonly forced: boolean
  /** A toggle whose write hasn't landed; shown ahead of the stored preference. */
  readonly pendingCollapsed: boolean | null
  readonly peek: RailPeek | null
}

export type RailDisplayEvent =
  | { type: 'resize'; width: number }
  | { type: 'setCollapsed'; collapsed: boolean }
  | { type: 'persisted'; collapsed: boolean }
  | { type: 'openPeek'; peek: RailPeek; storedCollapsed: boolean }
  | { type: 'closePeek' }

export function initialRailDisplay(width: number): RailDisplayState {
  return {
    lastWidth: width,
    forced: width < RAIL_COLLAPSE_BELOW_PX,
    pendingCollapsed: null,
    peek: null,
  }
}

export function isRailCollapsed(state: RailDisplayState, storedCollapsed: boolean): boolean {
  return state.forced || (state.pendingCollapsed ?? storedCollapsed)
}

export function reduceRailDisplay(
  state: RailDisplayState,
  event: RailDisplayEvent,
): RailDisplayState {
  switch (event.type) {
    case 'resize': {
      const { width } = event
      if (state.lastWidth >= RAIL_COLLAPSE_BELOW_PX && width < RAIL_COLLAPSE_BELOW_PX) {
        return { ...state, lastWidth: width, forced: true, peek: null }
      }
      if (state.lastWidth <= RAIL_RESTORE_ABOVE_PX && width > RAIL_RESTORE_ABOVE_PX) {
        return { ...state, lastWidth: width, forced: false }
      }
      return { ...state, lastWidth: width }
    }
    case 'setCollapsed':
      return {
        ...state,
        forced: false,
        pendingCollapsed: event.collapsed,
        peek: event.collapsed ? null : state.peek,
      }
    case 'persisted':
      return state.pendingCollapsed === event.collapsed
        ? { ...state, pendingCollapsed: null }
        : state
    case 'openPeek':
      return isRailCollapsed(state, event.storedCollapsed) ? state : { ...state, peek: event.peek }
    case 'closePeek':
      return state.peek == null ? state : { ...state, peek: null }
  }
}
