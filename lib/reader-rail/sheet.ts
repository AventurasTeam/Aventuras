import type { RailPeek } from './categories'

// reader-composer.md → Mobile expression: one Sheet; content swaps in place, the detent follows.
export type RailSheetState =
  | { readonly content: 'categories'; readonly size: 'medium' }
  | { readonly content: 'list'; readonly size: 'medium' }
  | { readonly content: 'peek'; readonly size: 'tall'; readonly peek: RailPeek }

export type RailSheetEvent =
  | { type: 'up' }
  | { type: 'pickCategory' }
  | { type: 'openPeek'; peek: RailPeek }
  | { type: 'back' }

/**
 * Where every open starts: the current category's list at the medium detent.
 * Frozen, since hosts adopt it as their state.
 */
export const RAIL_SHEET_OPENED: RailSheetState = Object.freeze({ content: 'list', size: 'medium' })

/** A legal move returns the next level; any other pairing returns `state` itself. */
export function reduceRailSheet(state: RailSheetState, event: RailSheetEvent): RailSheetState {
  switch (event.type) {
    case 'up':
      return state.content === 'list' ? { content: 'categories', size: 'medium' } : state
    case 'pickCategory':
      return state.content === 'categories' ? { content: 'list', size: 'medium' } : state
    case 'openPeek':
      return state.content === 'list' ? { content: 'peek', size: 'tall', peek: event.peek } : state
    case 'back':
      return state.content === 'peek' ? { content: 'list', size: 'medium' } : state
  }
}
