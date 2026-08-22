/**
 * Whether the Actions menu's trigger and its `Cmd/Ctrl-K` shortcut are both inert.
 *
 * Two off-reasons, one derived and one not. `openSheets` counts every registered
 * phone sheet — Sheet-over-Sheet is disallowed, and a sheet opened by a primitive
 * (a Select, a picker) is invisible to the route, so it cannot be a prop. `blocked`
 * is the judgment half: the surface is mid-decision and must be answered first.
 *
 * The menu is itself a sheet on phone and registers like any other, so it
 * discounts its own — otherwise opening it would gate it shut, and the shortcut
 * that opened it could not dismiss it.
 */
export function isActionsMenuInert(
  blocked: boolean | undefined,
  openSheets: number,
  selfOpen: boolean,
): boolean {
  return blocked === true || openSheets - (selfOpen ? 1 : 0) > 0
}
