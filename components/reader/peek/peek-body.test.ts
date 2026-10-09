import { describe, expect, it, vi } from 'vitest'

import { OverviewTab } from '@/components/world/detail/common-tabs'
import type { EntityPaneData } from '@/components/world/detail/entity-pane-props'
import { EntityOverview } from '@/components/world/overview/entity-overview'
import { EARTH_GREGORIAN } from '@/lib/calendar'
import type { Happening, Thread } from '@/lib/db'
import type { EntryIndex } from '@/lib/entry-refs'
import { makeEntity, makeLore } from '@/lib/list-modules/__tests__/fixtures'

import { HappeningPeekBody } from './happening-peek-body'
import { LorePeekBody } from './lore-peek-body'
import { PEEK_ENTITY_BODY, PeekBody, type PeekBodyProps } from './peek-body'
import { ThreadPeekBody } from './thread-peek-body'
import type { PeekEntityContext, PeekEntryIndex } from './use-peek-view'

// The real components pull in the RN tree, which the unit bundler can't load; only which
// component each kind mounts, and with what, is asserted here.
vi.mock('@/components/world/overview/entity-overview', () => ({ EntityOverview: () => null }))
vi.mock('./lore-peek-body', () => ({ LorePeekBody: () => null }))
vi.mock('./thread-peek-body', () => ({ ThreadPeekBody: () => null }))
vi.mock('./happening-peek-body', () => ({ HappeningPeekBody: () => null }))
vi.mock('@/components/history/history-tab', () => ({ HistoryTab: () => null }))
vi.mock('@/components/ui/tabs', () => ({ TabsContent: () => null }))
vi.mock('@/components/world/tabs/involvements-tab', () => ({ InvolvementsTab: () => null }))
vi.mock('@/components/world/tabs/placeholder-tab', () => ({ PlaceholderTab: () => null }))

const KAEL = makeEntity({ id: 'char_kael', kind: 'character', name: 'Kael' })
const VEIL = makeLore({ id: 'lore_veil', title: 'The Veil' })
const AMULET = { id: 't_amulet', title: 'What the amulet wants' } as Thread
const AMBUSH = { id: 'h_ambush', title: 'The alley ambush' } as Happening

const CONTEXT: PeekEntityContext = { entities: [KAEL], worldTime: 120, calendar: EARTH_GREGORIAN }
const INDEX: EntryIndex = new Map()
const READ: PeekEntryIndex = { state: 'ready', index: INDEX }
const FAILED: PeekEntryIndex = { state: 'failed' }

const PANE_DATA: EntityPaneData = {
  branchId: 'br_1',
  entities: [KAEL],
  relationships: [],
  involvements: [],
  entryIndex: INDEX,
  worldTime: 120,
  calendar: EARTH_GREGORIAN,
  leadId: null,
}

function props(model: PeekBodyProps['model'], entryIndex: PeekEntryIndex = READ) {
  return { model, entityContext: CONTEXT, entryIndex, onRegionPress: vi.fn() }
}

describe('PEEK_ENTITY_BODY', () => {
  // OverviewTab calls no hooks either: its TabsContent's child is what World mounts.
  it('is the Overview component World’s Overview tab mounts', () => {
    const tab = OverviewTab({ row: KAEL, data: PANE_DATA, onRegionPress: vi.fn() })
    expect(tab.props.value).toBe('overview')
    expect(tab.props.children.type).toBe(PEEK_ENTITY_BODY)
  })
})

// PeekBody calls no hooks, so calling it returns the element it would mount.
describe('PeekBody', () => {
  it('mounts the Overview in its peek variant for an entity', () => {
    const p = props({ kind: 'entity', row: KAEL, recentlyClassified: undefined, leadLabel: 'you' })
    const element = PeekBody(p)
    expect(element.type).toBe(EntityOverview)
    expect(element.props).toEqual({
      variant: 'peek',
      entity: KAEL,
      entities: CONTEXT.entities,
      worldTime: 120,
      calendar: EARTH_GREGORIAN,
      onRegionPress: expect.any(Function),
    })
  })

  it('hands a region press back with the peeked entity and the tab', () => {
    const p = props({ kind: 'entity', row: KAEL, recentlyClassified: undefined, leadLabel: 'you' })
    const element = PeekBody(p)
    element.props.onRegionPress('identity')
    expect(p.onRegionPress).toHaveBeenCalledTimes(1)
    expect(p.onRegionPress).toHaveBeenCalledWith(KAEL, 'identity')
  })

  it('mounts the lore, thread and happening bodies for their kinds', () => {
    const lore = PeekBody(props({ kind: 'lore', row: VEIL, recentlyClassified: undefined }))
    expect(lore.type).toBe(LorePeekBody)
    expect(lore.props).toEqual({ lore: VEIL })

    const thread = PeekBody(props({ kind: 'thread', row: AMULET, recentlyClassified: 'fresh' }))
    expect(thread.type).toBe(ThreadPeekBody)
    expect(thread.props).toEqual({ thread: AMULET })

    const model = {
      kind: 'happening',
      row: AMBUSH,
      recentlyClassified: undefined,
      involved: 3,
      aware: 1,
    } as const
    const happening = PeekBody(props(model))
    expect(happening.type).toBe(HappeningPeekBody)
    expect(happening.props).toEqual({ happening: AMBUSH, involved: 3, aware: 1, entryIndex: READ })
    expect(PeekBody(props(model, FAILED)).props.entryIndex).toBe(FAILED)
  })
})
