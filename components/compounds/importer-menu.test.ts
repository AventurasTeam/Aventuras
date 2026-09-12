import { describe, expect, it } from 'vitest'

import type { ImporterMenuProps } from './importer-menu'

const BASE = { label: 'New character', options: [] }

// Pinned at typecheck: an unused @ts-expect-error fails `tsc`, so a loosened seam fails the build.
describe('ImporterMenuProps', () => {
  it('types the controlled seam as all-or-nothing', () => {
    const uncontrolled: ImporterMenuProps = { ...BASE }
    const observed: ImporterMenuProps = { ...BASE, onOpenChange: () => {} }
    const controlled: ImporterMenuProps = { ...BASE, open: true, onOpenChange: () => {} }
    // @ts-expect-error — `open` alone never learns of an outside close, so it can't reopen.
    const stuck: ImporterMenuProps = { ...BASE, open: true }
    expect([uncontrolled, observed, controlled, stuck]).toHaveLength(4)
  })
})
