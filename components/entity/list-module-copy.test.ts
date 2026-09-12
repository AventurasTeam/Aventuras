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

  it('lowercases the label in the app language, not the host locale', () => {
    const hostLower = String.prototype.toLocaleLowerCase
    // A Turkish host lowercases "I" to a dotless "ı" when no locale is passed.
    const spy = vi.spyOn(String.prototype, 'toLocaleLowerCase').mockImplementation(function (
      this: string,
      locales?: Parameters<string['toLocaleLowerCase']>[0],
    ) {
      return hostLower.call(this, locales ?? 'tr')
    })
    try {
      const itemCopy = entityListModule('item').copy('Items')
      expect(itemCopy.searchPlaceholder).toBe('Search items…')
      expect(itemCopy.emptyTitle).toBe('No items on this branch yet.')
      const loreCopy = loreListModule.copy('Index')
      expect(loreCopy.searchPlaceholder).toBe('Search index…')
      expect(loreCopy.emptyTitle).toBe('No index on this branch yet.')
    } finally {
      spy.mockRestore()
    }
  })
})
