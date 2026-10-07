import { describe, expect, it, vi } from 'vitest'

import { entityListModule } from '@/components/entity/entity-list-module'
import { loreListModule } from '@/components/entity/lore-list-module'
import { happeningListModule } from '@/components/plot/happening-list-module'
import { threadListModule } from '@/components/plot/thread-list-module'
import { RAIL_CATEGORIES } from '@/lib/reader-rail'

import { RAIL_MODULES, railCategoryLabel, railEmptySubtext, railRowHref } from './rail-modules'

// The row renderers drag in the RN component tree; these tests never render a row.
vi.mock('@/components/entity/entity-row', () => ({ EntityRow: () => null }))
vi.mock('@/components/entity/lore-row', () => ({ LoreRow: () => null }))
vi.mock('@/components/plot/thread-row', () => ({ ThreadRow: () => null }))
vi.mock('@/components/plot/happening-row', () => ({ HappeningRow: () => null }))

describe('RAIL_MODULES', () => {
  it('mounts the panels’ own module objects for all seven categories', () => {
    expect(RAIL_MODULES.character).toBe(entityListModule('character'))
    expect(RAIL_MODULES.location).toBe(entityListModule('location'))
    expect(RAIL_MODULES.item).toBe(entityListModule('item'))
    expect(RAIL_MODULES.faction).toBe(entityListModule('faction'))
    expect(RAIL_MODULES.lore).toBe(loreListModule)
    expect(RAIL_MODULES.thread).toBe(threadListModule)
    expect(RAIL_MODULES.happening).toBe(happeningListModule)
  })

  it('covers exactly the rail vocabulary', () => {
    expect(Object.keys(RAIL_MODULES).sort()).toEqual([...RAIL_CATEGORIES].sort())
  })
})

describe('railCategoryLabel', () => {
  it('says Places where World says Locations', () => {
    expect(railCategoryLabel('location')).toBe('Places')
    expect(railCategoryLabel('character')).toBe('Characters')
    expect(railCategoryLabel('lore')).toBe('Lore')
    expect(railCategoryLabel('happening')).toBe('Happenings')
  })

  it('rotates the search placeholder through the shared module copy', () => {
    expect(RAIL_MODULES.location.copy(railCategoryLabel('location')).searchPlaceholder).toBe(
      'Search places…',
    )
    expect(RAIL_MODULES.thread.copy(railCategoryLabel('thread')).searchPlaceholder).toBe(
      'Search threads…',
    )
    expect(RAIL_MODULES.lore.copy(railCategoryLabel('lore')).searchPlaceholder).toBe('Search lore…')
  })
})

describe('railEmptySubtext', () => {
  it('points lore at the World panel', () => {
    expect(railEmptySubtext('lore')).toBe('Add lore from the World panel.')
  })

  it('names the classifier for every other category, with no + New clause', () => {
    for (const category of RAIL_CATEGORIES.filter((c) => c !== 'lore')) {
      expect(railEmptySubtext(category)).toBe(
        'The classifier writes most rows automatically as the story progresses.',
      )
    }
  })
})

describe('railRowHref', () => {
  it('routes World rows to World with the row pre-selected', () => {
    expect(railRowHref('br_1', 'location', 'loc_1')).toBe('/world/br_1?kind=location&id=loc_1')
    expect(railRowHref('br_1', 'lore', 'lore_1')).toBe('/world/br_1?kind=lore&id=lore_1')
  })

  it('routes Plot rows to Plot with the row pre-selected', () => {
    expect(railRowHref('br_1', 'thread', 't_1')).toBe('/plot/br_1?kind=thread&id=t_1')
    expect(railRowHref('br_1', 'happening', 'h_1')).toBe('/plot/br_1?kind=happening&id=h_1')
  })
})
