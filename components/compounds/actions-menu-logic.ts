/**
 * Whether the Actions menu's trigger and its `Cmd/Ctrl-K` shortcut are both inert.
 *
 * Two off-reasons. `overlayCount` counts every registered blocking overlay — a
 * bottom sheet or a modal dialog. Stacking on one is disallowed, and an overlay
 * opened by a primitive (a Select, a picker) or mounted above the router (the
 * crash-recovery and swap-resume hosts) is invisible to the route, so it cannot
 * be a prop. `blocked` is the judgment half: the surface is mid-decision.
 *
 * The menu's own sheet opts out of registering, so there is no self-discount to
 * keep in step with which tier renders the menu as a sheet rather than a popover.
 */
export function isActionsMenuInert(blocked: boolean | undefined, overlayCount: number): boolean {
  return blocked === true || overlayCount > 0
}
