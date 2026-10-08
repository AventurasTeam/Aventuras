import { describe, expect, it, vi } from 'vitest'

import { EntityOverview } from '@/components/world/overview/entity-overview'
import { EARTH_GREGORIAN } from '@/lib/calendar'
import type { Happening, Thread } from '@/lib/db'
import type { EntryIndex } from '@/lib/entry-refs'
import { makeEntity, makeLore } from '@/lib/list-modules/__tests__/fixtures'

import { HappeningPeekBody } from './happening-peek-body'
import { LorePeekBody } from './lore-peek-body'
import { PEEK_ENTITY_BODY, PeekBody, type PeekBodyProps } from './peek-body'
import { ThreadPeekBody } from './thread-peek-body'
import type { PeekEntityContext } from './use-peek-view'

// The real components pull in the RN tree, which the unit bundler can't load; only which
// component each kind mounts, and with what, is asserted here.
vi.mock('@/components/world/overview/entity-overview', () => ({ EntityOverview: () => null }))
vi.mock('./lore-peek-body', () => ({ LorePeekBody: () => null }))
vi.mock('./thread-peek-body', () => ({ ThreadPeekBody: () => null }))
vi.mock('./happening-peek-body', () => ({ HappeningPeekBody: () => null }))

const KAEL = makeEntity({ id: 'char_kael', kind: 'character', name: 'Kael' })
const VEIL = makeLore({ id: 'lore_veil', title: 'The Veil' })
const AMULET = { id: 't_amulet', title: 'What the amulet wants' } as Thread
const AMBUSH = { id: 'h_ambush', title: 'The alley ambush' } as Happening

const CONTEXT: PeekEntityContext = { entities: [KAEL], worldTime: 120, calendar: EARTH_GREGORIAN }
const INDEX: EntryIndex = new Map()

function props(model: PeekBodyProps['model'], entryIndex: EntryIndex | null = INDEX) {
  return { model, entityContext: CONTEXT, entryIndex, onRegionPress: vi.fn() }
}

describe('PEEK_ENTITY_BODY', () => {
  it('is the Overview component World’s Overview tab mounts', () => {
    expect(PEEK_ENTITY_BODY).toBe(EntityOverview)
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
      onRegionPress: p.onRegionPress,
    })
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
    expect(happening.props).toEqual({ happening: AMBUSH, involved: 3, aware: 1, entryIndex: INDEX })
    expect(PeekBody(props(model, null)).props).toMatchObject({ entryIndex: null })
  })
})
