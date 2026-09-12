import { describe, expect, it, vi } from 'vitest'

import { entityListModule } from './entity-list-module'
import { loreListModule } from './lore-list-module'

// The row renderers drag in the RN component tree; this test reads only copy().
vi.mock('@/components/entity/entity-row', () => ({ EntityRow: () => null }))
vi.mock('@/components/entity/lore-row', () => ({ LoreRow: () => null }))

describe('list module copy', () => {
  it('renders the standard World category label unchanged', () => {
    expect(entityListModule('location').copy('Locations').emptyTitle).toBe(
      'No locations on this branch yet.',
    )
    expect(loreListModule.copy('Lore').emptyTitle).toBe('No lore on this branch yet.')
  })

  it('interpolates a surface-supplied label instead of hardcoding the kind noun', () => {
    expect(entityListModule('location').copy('Places').emptyTitle).toBe(
      'No places on this branch yet.',
    )
    expect(loreListModule.copy('Codex').emptyTitle).toBe('No codex on this branch yet.')
  })
})
