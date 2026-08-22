import { describe, expect, it } from 'vitest'

import { isActionsMenuInert } from './actions-menu-logic'

describe('isActionsMenuInert', () => {
  it('stays live with nothing open and no block', () => {
    expect(isActionsMenuInert(undefined, 0, false)).toBe(false)
    expect(isActionsMenuInert(false, 0, false)).toBe(false)
  })

  it('goes inert while the surface is mid-decision', () => {
    expect(isActionsMenuInert(true, 0, false)).toBe(true)
  })

  it("goes inert while another surface's sheet is open", () => {
    // The mode Select on the reader composer: a sheet the route cannot see.
    expect(isActionsMenuInert(undefined, 1, false)).toBe(true)
  })

  it('discounts its own sheet, so an open menu is not gated shut', () => {
    // Without the discount the menu would disable its own trigger and the
    // shortcut that opened it, leaving no way to dismiss it.
    expect(isActionsMenuInert(undefined, 1, true)).toBe(false)
  })

  it('stays inert when a foreign sheet is open underneath its own', () => {
    expect(isActionsMenuInert(undefined, 2, true)).toBe(true)
  })

  it('honours blocked even when the discount would clear the sheet count', () => {
    expect(isActionsMenuInert(true, 1, true)).toBe(true)
  })
})
