import { describe, expect, it } from 'vitest'

import { isActionsMenuInert } from './actions-menu-logic'

describe('isActionsMenuInert', () => {
  it('stays live with nothing open and no block', () => {
    expect(isActionsMenuInert(undefined, 0)).toBe(false)
    expect(isActionsMenuInert(false, 0)).toBe(false)
  })

  it('goes inert while the surface is mid-decision', () => {
    expect(isActionsMenuInert(true, 0)).toBe(true)
  })

  it("goes inert while another surface's overlay is open", () => {
    // The mode Select on the reader composer: a sheet the route cannot see.
    expect(isActionsMenuInert(undefined, 1)).toBe(true)
  })

  it('goes inert under a modal mounted above the router', () => {
    // The crash-recovery and swap-resume hosts sit outside every route's state,
    // so no `blocked` prop can reach them — the count is the only signal.
    expect(isActionsMenuInert(false, 1)).toBe(true)
  })

  it('treats only `true` as blocked, so an undefined prop cannot gate it shut', () => {
    expect(isActionsMenuInert(undefined, 0)).toBe(false)
  })
})
