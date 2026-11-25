import { describe, expect, it } from 'vitest'

import {
  DIFF_TABLES,
  diffPaths,
  entryIdsOf,
  proseFieldOf,
  refIdsOf,
  type DiffTable,
  type ProseFieldKind,
} from './prose-fields'

// world.md → Change prose, the Kind table, one row per payload path.
const KIND_TABLE: readonly [DiffTable, string, ProseFieldKind][] = [
  ['entities', 'name', 'text'],
  ['entities', 'description', 'text'],
  ['entities', 'retiredReason', 'text'],
  ['entities', 'state.voice', 'text'],
  ['entities', 'state.condition', 'text'],
  ['entities', 'state.standing', 'text'],
  ['entities', 'state.visual.physique', 'text'],
  ['entities', 'state.visual.face', 'text'],
  ['entities', 'state.visual.hair', 'text'],
  ['entities', 'state.visual.eyes', 'text'],
  ['entities', 'state.visual.attire', 'text'],
  ['entities', 'state.visual.distinguishing', 'text'],
  ['entities', 'status', 'enum'],
  ['entities', 'injectionMode', 'enum'],
  ['entities', 'priority', 'number'],
  ['entities', 'isLead', 'flag'],
  ['entities', 'tags', 'termList'],
  ['entities', 'keywords', 'termList'],
  ['entities', 'state.traits', 'termList'],
  ['entities', 'state.drives', 'termList'],
  ['entities', 'state.agenda', 'termList'],
  ['entities', 'state.current_location_id', 'rowRef'],
  ['entities', 'state.faction_id', 'rowRef'],
  ['entities', 'state.at_location_id', 'rowRef'],
  ['entities', 'state.inventory', 'refList'],
  ['entities', 'state.equipped_items', 'refList'],
  ['entities', 'state.stackables', 'record'],
  ['entities', 'state.lastSeenAt', 'lastSeen'],
  ['entities', 'state.parent_location_id', 'placement'],
  ['entities', 'state.unplaced', 'placement'],
  ['entities', 'nameCollisionFlag', 'collision'],
  ['entities', 'nameCollisionPartnerId', 'collision'],
  ['entities', 'nameCollisionReason', 'collision'],
  ['lore', 'title', 'text'],
  ['lore', 'body', 'text'],
  ['lore', 'category', 'text'],
  ['lore', 'tags', 'termList'],
  ['lore', 'keywords', 'termList'],
  ['lore', 'injectionMode', 'enum'],
  ['lore', 'priority', 'number'],
  ['threads', 'title', 'text'],
  ['threads', 'description', 'text'],
  ['threads', 'category', 'text'],
  ['threads', 'icon', 'text'],
  ['threads', 'status', 'enum'],
  ['threads', 'injectionMode', 'enum'],
  ['threads', 'triggeredAtEntryId', 'entryRef'],
  ['threads', 'resolvedAtEntryId', 'entryRef'],
  ['happenings', 'title', 'text'],
  ['happenings', 'description', 'text'],
  ['happenings', 'category', 'text'],
  ['happenings', 'icon', 'text'],
  ['happenings', 'temporal', 'text'],
  ['happenings', 'occurredAtEntryId', 'entryRef'],
  ['happenings', 'commonKnowledge', 'flag'],
  ['character_relationships', 'kind', 'text'],
  ['character_relationships', 'inverseKind', 'text'],
  ['happening_involvements', 'role', 'text'],
  ['happening_awareness', 'source', 'text'],
  ['happening_awareness', 'decayResistance', 'number'],
  ['happening_awareness', 'retrievalCount', 'number'],
  ['happening_awareness', 'learnedAtEntryId', 'entryRef'],
]

const NO_WORDING: readonly [DiffTable, string][] = [
  ['entities', 'state'],
  ['entities', 'state.visual'],
  ['entities', 'state.mood'],
  ['entities', 'embeddingStale'],
  ['entities', 'title'],
  ['lore', 'name'],
  ['lore', 'state.traits'],
  ['threads', 'commonKnowledge'],
  ['happenings', 'status'],
  ['character_relationships', 'role'],
  ['happening_involvements', 'kind'],
  ['happening_awareness', 'toString'],
  ['happening_awareness', 'constructor'],
]

describe('DIFF_TABLES', () => {
  it('lists the four row tables, then the three link tables', () => {
    expect(DIFF_TABLES).toEqual([
      'entities',
      'lore',
      'threads',
      'happenings',
      'character_relationships',
      'happening_involvements',
      'happening_awareness',
    ])
  })
})

describe('proseFieldOf', () => {
  it.each(KIND_TABLE)('reads %s %s as %s', (table, path, kind) => {
    expect(proseFieldOf(table, path)).toBe(kind)
  })

  it.each(NO_WORDING)('gives %s %s no wording', (table, path) => {
    expect(proseFieldOf(table, path)).toBeUndefined()
  })
})

describe('diffPaths', () => {
  it("reads old's keys in payload order, descending state and state.visual, skipping $ keys", () => {
    expect(
      diffPaths({
        old: {
          description: 'A wary ranger.',
          state: { traits: ['brave'], visual: { hair: 'red', eyes: 'grey' }, voice: 'low' },
          $resolvedPair: 'char_kaelan',
          name: 'Kael',
        },
        new: {
          description: 'A wary ranger. He once served the crown.',
          state: { traits: ['brave', 'scarred'], visual: {}, voice: 'gravelly' },
          name: 'Kael the Wary',
        },
      }),
    ).toEqual([
      'description',
      'state.traits',
      'state.visual.hair',
      'state.visual.eyes',
      'state.voice',
      'name',
    ])
  })

  it("never reads new's keys", () => {
    expect(
      diffPaths({
        old: { state: { traits: ['brave'] } },
        new: { state: { traits: ['brave', 'former soldier'], drives: ['home'], voice: 'low' } },
      }),
    ).toEqual(['state.traits'])
  })

  it('keeps a null-old stackables as one path', () => {
    expect(
      diffPaths({
        old: { state: { stackables: null } },
        new: { state: { stackables: { gold: 250, arrows: 12 } } },
      }),
    ).toEqual(['state.stackables'])
  })

  it('keeps a null-old state and a null-old visual undescended', () => {
    expect(diffPaths({ old: { state: null }, new: { state: { traits: [] } } })).toEqual(['state'])
    expect(
      diffPaths({ old: { state: { visual: null } }, new: { state: { visual: { hair: 'red' } } } }),
    ).toEqual(['state.visual'])
  })
})

describe('refIdsOf', () => {
  it('reads a row ref on both sides, and only on the paths old names', () => {
    expect(
      refIdsOf('entities', {
        old: { state: { faction_id: 'fac_old' } },
        new: { state: { faction_id: 'fac_iron', current_location_id: 'loc_tavern' } },
      }),
    ).toEqual(['fac_old', 'fac_iron'])
  })

  it('skips a null side', () => {
    expect(
      refIdsOf('entities', {
        old: { state: { current_location_id: null } },
        new: { state: { current_location_id: 'loc_tavern' } },
      }),
    ).toEqual(['loc_tavern'])
  })

  it('reads every id of a ref list on both sides, deduplicated, first seen first', () => {
    expect(
      refIdsOf('entities', {
        old: { state: { inventory: ['item_rope', 'item_coin'], equipped_items: ['item_sword'] } },
        new: { state: { inventory: ['item_coin', 'item_silver'], equipped_items: ['item_rope'] } },
      }),
    ).toEqual(['item_rope', 'item_coin', 'item_silver', 'item_sword'])
  })

  it("reads a place's parent from the payload, then from new", () => {
    expect(
      refIdsOf('entities', {
        old: { state: { parent_location_id: 'loc_quarter' } },
        new: { state: { parent_location_id: 'loc_old', condition: 'flooded' } },
      }),
    ).toEqual(['loc_quarter', 'loc_old'])
  })

  it("takes a place's parent from new when the payload holds only the mark", () => {
    expect(
      refIdsOf('entities', {
        old: { state: { unplaced: null } },
        new: { state: { parent_location_id: 'loc_quarter' } },
      }),
    ).toEqual(['loc_quarter'])
  })

  it('reads the collision partner on both sides, from new when the payload lacks it', () => {
    expect(
      refIdsOf('entities', {
        old: {
          nameCollisionFlag: 1,
          nameCollisionPartnerId: 'char_kaelan',
          nameCollisionReason: 'alike',
        },
        new: { nameCollisionFlag: 0, nameCollisionPartnerId: null, nameCollisionReason: null },
      }),
    ).toEqual(['char_kaelan'])
    expect(
      refIdsOf('entities', {
        old: { nameCollisionReason: 'alike' },
        new: {
          nameCollisionFlag: 1,
          nameCollisionPartnerId: 'char_kaelan',
          nameCollisionReason: 'duplicate',
        },
      }),
    ).toEqual(['char_kaelan'])
  })

  it("reads lastSeenAt's place on both sides, a partial old taking it from new", () => {
    expect(
      refIdsOf('entities', {
        old: {
          state: { lastSeenAt: { entryId: 'ent_40', locationId: 'loc_tavern', worldTime: 3 } },
        },
        new: {
          state: { lastSeenAt: { entryId: 'ent_47', locationId: 'loc_market', worldTime: 5 } },
        },
      }),
    ).toEqual(['loc_tavern', 'loc_market'])
    expect(
      refIdsOf('entities', {
        old: { state: { lastSeenAt: { entryId: 'ent_40' } } },
        new: {
          state: { lastSeenAt: { entryId: 'ent_47', locationId: 'loc_market', worldTime: 5 } },
        },
      }),
    ).toEqual(['loc_market'])
    expect(
      refIdsOf('entities', {
        old: { state: { lastSeenAt: null } },
        new: { state: { lastSeenAt: { entryId: 'ent_3', locationId: null, worldTime: 1 } } },
      }),
    ).toEqual([])
  })

  it('finds none in a text, list or entry-ref path', () => {
    expect(
      refIdsOf('entities', {
        old: { name: 'Kael', state: { traits: ['brave'] } },
        new: { name: 'Kael the Wary', state: { traits: ['brave', 'scarred'] } },
      }),
    ).toEqual([])
    expect(
      refIdsOf('threads', {
        old: { resolvedAtEntryId: null },
        new: { resolvedAtEntryId: 'ent_31' },
      }),
    ).toEqual([])
  })
})

describe('entryIdsOf', () => {
  it('lists the ids an entry-ref path holds on either side, on any table that has one', () => {
    expect(
      entryIdsOf('threads', {
        old: { resolvedAtEntryId: null },
        new: { resolvedAtEntryId: 'ent_31' },
      }),
    ).toEqual(['ent_31'])
    expect(
      entryIdsOf('happenings', {
        old: { occurredAtEntryId: 'ent_9' },
        new: { occurredAtEntryId: 'ent_12' },
      }),
    ).toEqual(['ent_9', 'ent_12'])
    expect(
      entryIdsOf('happening_awareness', {
        old: { learnedAtEntryId: 'ent_4' },
        new: { learnedAtEntryId: '' },
      }),
    ).toEqual(['ent_4'])
  })

  it("lists lastSeenAt's entry on either side, never its place", () => {
    expect(
      entryIdsOf('entities', {
        old: { state: { lastSeenAt: { entryId: 'ent_2', locationId: 'loc_dock', worldTime: 1 } } },
        new: { state: { lastSeenAt: { entryId: 'ent_3', locationId: 'loc_gate', worldTime: 2 } } },
      }),
    ).toEqual(['ent_2', 'ent_3'])
    expect(
      entryIdsOf('entities', {
        old: { state: { lastSeenAt: { entryId: 'ent_3', locationId: null, worldTime: 1 } } },
        new: { state: { lastSeenAt: null } },
      }),
    ).toEqual(['ent_3'])
    expect(
      entryIdsOf('entities', {
        old: { state: { lastSeenAt: null } },
        new: { state: { lastSeenAt: null } },
      }),
    ).toEqual([])
  })

  it('lists nothing for an entry with no entry ref', () => {
    expect(
      entryIdsOf('threads', { old: { title: 'Get the herd across' }, new: { title: 'Cross' } }),
    ).toEqual([])
    expect(
      entryIdsOf('entities', {
        old: { state: { faction_id: null } },
        new: { state: { faction_id: 'fac_iron' } },
      }),
    ).toEqual([])
  })
})
