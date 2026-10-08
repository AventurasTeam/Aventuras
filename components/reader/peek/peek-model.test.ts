import { describe, expect, it, vi } from 'vitest'

import type { RailData } from '@/components/reader/rail/use-rail-data'
import type { Happening, HappeningAwareness, HappeningInvolvement, Thread } from '@/lib/db'
import { makeEntity, makeLore } from '@/lib/list-modules/__tests__/fixtures'
import type { RailCategory } from '@/lib/reader-rail'
import type { RecentlyClassified } from '@/lib/row-signals'
import type { LeadLabel } from '@/lib/world'

import {
  peekLeadOf,
  peekModelOf,
  type PeekLeadControl,
  type PeekLinks,
  type PeekModel,
} from './peek-model'

const BRANCH = 'br_1'

function thread(id: string, title: string): Thread {
  return {
    id,
    branchId: BRANCH,
    title,
    description: null,
    category: null,
    icon: null,
    status: 'active',
    injectionMode: 'auto',
    triggeredAtEntryId: null,
    resolvedAtEntryId: null,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
  }
}

function happening(id: string, title: string): Happening {
  return {
    id,
    branchId: BRANCH,
    title,
    description: null,
    category: null,
    icon: null,
    temporal: null,
    occurredAtEntryId: null,
    commonKnowledge: 0,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
  }
}

function involvement(id: string, happeningId: string, branchId = BRANCH): HappeningInvolvement {
  return { id, branchId, happeningId, entityId: 'char_kael', role: null }
}

function awareness(id: string, happeningId: string, branchId = BRANCH): HappeningAwareness {
  return {
    id,
    branchId,
    happeningId,
    characterId: 'char_kael',
    learnedAtEntryId: null,
    decayResistance: null,
    retrievalCount: 0,
    source: null,
  }
}

const KAEL = makeEntity({ id: 'char_kael', kind: 'character', name: 'Kael' })
const MIRA = makeEntity({ id: 'char_mira', kind: 'character', name: 'Mira' })
const SAGE = makeEntity({
  id: 'char_sage',
  kind: 'character',
  name: 'The Ashen Sage',
  status: 'staged',
})
const BRAN = makeEntity({ id: 'char_bran', kind: 'character', name: 'Bran', status: 'retired' })
const HOLLOW = makeEntity({ id: 'loc_hollow', kind: 'location', name: "Veil's Hollow" })
const BLADE = makeEntity({ id: 'item_blade', kind: 'item', name: 'Courier blade' })
const WATCH = makeEntity({ id: 'fac_watch', kind: 'faction', name: 'The Watch' })
const VEIL = makeLore({ id: 'lore_veil', title: 'The Veil' })
const AMULET = thread('t_amulet', 'What the amulet wants')
const AMBUSH = happening('h_ambush', 'The alley ambush')
const PACT = happening('h_pact', "Vorne's pact")

const TINTS: ReadonlyMap<string, RecentlyClassified> = new Map([
  ['char_mira', 'fresh'],
  ['lore_veil', 'fading'],
  ['t_amulet', 'fresh'],
  ['h_ambush', 'fading'],
])

/** Kael leads under `label`; null labels no row: synthetic, to pin `peekLeadOf`'s own `leadId` check. */
function railData(label: LeadLabel | null = 'you'): RailData {
  return {
    branchId: BRANCH,
    entities: [KAEL, MIRA, SAGE, BRAN, HOLLOW, BLADE, WATCH],
    lore: [VEIL],
    threads: [AMULET],
    happenings: [AMBUSH, PACT],
    entityListSignals: { leadId: 'char_kael', inScene: new Set() },
    hasClosedChapters: false,
    rowSignals: (id) => ({
      lead: id === 'char_kael' ? label : null,
      inScene: false,
      recentlyClassified: TINTS.get(id),
    }),
    categoryTint: new Map(),
  }
}

const NO_LINKS: PeekLinks = { involvements: new Map(), awareness: new Map() }

function byId<Row extends { id: string }>(rows: Row[]): ReadonlyMap<string, Row> {
  return new Map(rows.map((r) => [r.id, r]))
}

function modelOf(category: RailCategory, id: string, data = railData()): PeekModel {
  const model = peekModelOf({ category, id }, data, NO_LINKS)
  if (model == null) throw new Error(`no ${category} row ${id}`)
  return model
}

function control(over: Partial<PeekLeadControl> = {}): PeekLeadControl {
  return {
    leadId: 'char_kael',
    blocked: false,
    blockedReason: undefined,
    pending: false,
    onSetLead: vi.fn<(entityId: string) => void>(),
    ...over,
  }
}

describe('peekModelOf', () => {
  it('resolves a character with its row tint and no lead label off the lead', () => {
    expect(peekModelOf({ category: 'character', id: 'char_mira' }, railData(), NO_LINKS)).toEqual({
      kind: 'entity',
      row: MIRA,
      recentlyClassified: 'fresh',
      leadLabel: null,
    })
  })

  it('carries the lead label, in either mode, on the resolved lead only', () => {
    expect(modelOf('character', 'char_kael')).toMatchObject({ kind: 'entity', leadLabel: 'you' })
    expect(modelOf('character', 'char_kael', railData('protagonist'))).toMatchObject({
      kind: 'entity',
      leadLabel: 'protagonist',
    })
  })

  it('resolves locations, items and factions as entities', () => {
    expect(modelOf('location', 'loc_hollow')).toMatchObject({ kind: 'entity', row: HOLLOW })
    expect(modelOf('item', 'item_blade')).toMatchObject({ kind: 'entity', row: BLADE })
    expect(modelOf('faction', 'fac_watch')).toMatchObject({ kind: 'entity', row: WATCH })
  })

  it('returns null when the category names another kind than the row', () => {
    expect(peekModelOf({ category: 'location', id: 'char_kael' }, railData(), NO_LINKS)).toBeNull()
    expect(
      peekModelOf({ category: 'character', id: 'loc_hollow' }, railData(), NO_LINKS),
    ).toBeNull()
    expect(peekModelOf({ category: 'thread', id: 'lore_veil' }, railData(), NO_LINKS)).toBeNull()
    expect(peekModelOf({ category: 'lore', id: 'h_ambush' }, railData(), NO_LINKS)).toBeNull()
  })

  it('returns null in every category once the row is gone', () => {
    const categories: RailCategory[] = [
      'character',
      'location',
      'item',
      'faction',
      'lore',
      'thread',
      'happening',
    ]
    for (const category of categories) {
      expect(peekModelOf({ category, id: 'gone' }, railData(), NO_LINKS)).toBeNull()
    }
  })

  it('resolves lore and threads with their row tint', () => {
    expect(modelOf('lore', 'lore_veil')).toEqual({
      kind: 'lore',
      row: VEIL,
      recentlyClassified: 'fading',
    })
    expect(modelOf('thread', 't_amulet')).toEqual({
      kind: 'thread',
      row: AMULET,
      recentlyClassified: 'fresh',
    })
  })

  it('counts a happening’s involvement and awareness rows on this branch only', () => {
    const links: PeekLinks = {
      involvements: byId([
        involvement('inv_1', 'h_ambush'),
        involvement('inv_2', 'h_ambush'),
        involvement('inv_3', 'h_ambush'),
        involvement('inv_4', 'h_ambush', 'br_2'),
        involvement('inv_5', 'h_pact'),
      ]),
      awareness: byId([
        awareness('aw_1', 'h_ambush'),
        awareness('aw_2', 'h_ambush', 'br_2'),
        awareness('aw_3', 'h_pact'),
        awareness('aw_4', 'h_pact'),
      ]),
    }
    expect(peekModelOf({ category: 'happening', id: 'h_ambush' }, railData(), links)).toEqual({
      kind: 'happening',
      row: AMBUSH,
      recentlyClassified: 'fading',
      involved: 3,
      aware: 1,
    })
    expect(peekModelOf({ category: 'happening', id: 'h_pact' }, railData(), links)).toMatchObject({
      involved: 1,
      aware: 2,
    })
  })
})

describe('peekLeadOf', () => {
  it('offers nothing on the six non-character kinds', () => {
    const others: [RailCategory, string][] = [
      ['location', 'loc_hollow'],
      ['item', 'item_blade'],
      ['faction', 'fac_watch'],
      ['lore', 'lore_veil'],
      ['thread', 't_amulet'],
      ['happening', 'h_ambush'],
    ]
    for (const [category, id] of others) {
      expect(peekLeadOf(modelOf(category, id), control())).toBeUndefined()
    }
  })

  it('shows the lead badge with the mode’s label', () => {
    expect(peekLeadOf(modelOf('character', 'char_kael'), control())).toEqual({
      state: 'lead',
      label: 'you',
    })
    expect(
      peekLeadOf(modelOf('character', 'char_kael', railData('protagonist')), control()),
    ).toEqual({ state: 'lead', label: 'protagonist' })
  })

  it('offers Set as lead on an active non-lead character, calling back with its id', () => {
    const lead = control()
    const offer = peekLeadOf(modelOf('character', 'char_mira'), lead)
    expect(offer).toMatchObject({ state: 'candidate', disabledReason: undefined, pending: false })
    if (offer?.state !== 'candidate') throw new Error('expected a candidate')
    offer.onSetLead()
    expect(lead.onSetLead).toHaveBeenCalledTimes(1)
    expect(lead.onSetLead).toHaveBeenCalledWith('char_mira')
  })

  it('disables it for a staged or retired character', () => {
    for (const id of ['char_sage', 'char_bran']) {
      expect(peekLeadOf(modelOf('character', id), control())).toMatchObject({
        state: 'candidate',
        disabledReason: 'Only an active character can be the lead',
      })
    }
  })

  it('disables it with the gate’s reason while edits are blocked', () => {
    const mira = modelOf('character', 'char_mira')
    expect(
      peekLeadOf(
        mira,
        control({ blocked: true, blockedReason: 'Chapter close in progress. Cancel to edit.' }),
      ),
    ).toMatchObject({ disabledReason: 'Chapter close in progress. Cancel to edit.' })
    expect(peekLeadOf(mira, control({ blocked: true }))).toMatchObject({
      disabledReason: 'Generation is in flight. Cancel to edit.',
    })
  })

  it('passes an in-flight call through as pending', () => {
    expect(peekLeadOf(modelOf('character', 'char_mira'), control({ pending: true }))).toMatchObject(
      { state: 'candidate', disabledReason: undefined, pending: true },
    )
  })

  it('never offers Set as lead on the lead, even when the row carries no label', () => {
    expect(peekLeadOf(modelOf('character', 'char_kael', railData(null)), control())).toMatchObject({
      state: 'candidate',
      disabledReason: 'Already the lead',
    })
  })
})
