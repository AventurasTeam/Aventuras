import { assertType, describe, it } from 'vitest'

import type { DetailPaneProps } from './detail-pane'

const HEAD = { kindIcon: null, kindName: 'character', nameSlot: null, children: null }

// Pinned at typecheck: an unused @ts-expect-error fails `tsc`, so a loosened slot fails the build.
describe('DetailPaneProps', () => {
  it('makes a pane state its tab strip and overflow menu, if only as null', () => {
    assertType<DetailPaneProps>({ ...HEAD, tabs: null, overflowMenu: null })
    // @ts-expect-error — a pane that forgot its tab strip would drop the deep link's tab target.
    assertType<DetailPaneProps>({ ...HEAD, overflowMenu: null })
    // @ts-expect-error — the ⋯ menu belongs to every real pane's head.
    assertType<DetailPaneProps>({ ...HEAD, tabs: null })
  })
})
