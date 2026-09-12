import { assertType, describe, it } from 'vitest'

import type { ImporterMenuProps } from './importer-menu'

const BASE = { label: 'New character', options: [] }

// Pinned at typecheck: an unused @ts-expect-error fails `tsc`, so a loosened seam fails the build.
describe('ImporterMenuProps', () => {
  it('types the controlled seam as all-or-nothing', () => {
    assertType<ImporterMenuProps>({ ...BASE })
    assertType<ImporterMenuProps>({ ...BASE, onOpenChange: () => {} })
    assertType<ImporterMenuProps>({ ...BASE, open: true, onOpenChange: () => {} })
    // @ts-expect-error — `open` alone never learns of an outside close, so it can't reopen.
    assertType<ImporterMenuProps>({ ...BASE, open: true })
  })
})
