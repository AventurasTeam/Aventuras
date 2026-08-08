export const DESKTOP_BREAKPOINT = 768
export const MIN_SIDEBAR_WIDTH = 250
export const MAX_SIDEBAR_WIDTH = 800
export const MAX_SIDEBAR_RATIO = 0.6

/**
 * How long a modal takes to leave the screen.
 *
 * Matches `vaul`'s own restore delay, so anything that has to happen *after* a close —
 * unmounting the component, dropping a cached snapshot, checking for an orphaned body
 * lock — waits the same amount everywhere.
 */
export const MODAL_CLOSE_TRANSITION_MS = 500
