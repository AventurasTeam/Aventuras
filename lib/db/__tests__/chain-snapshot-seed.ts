import type { createTestDb } from './test-db'
import type { CharacterState } from '../entities/entities-types'
import type { ChainSnapshotArgs } from '../runtime/chain-snapshot-queries'
import { branches, characterRelationships, deltas, entities, stories } from '../schema'
import type { Delta, NewEntity } from '../types'

export const STATE: CharacterState = {
  visual: { attire: 'travel cloak' },
  traits: ['brave'],
  drives: [],
  voice: 'low and dry',
  current_location_id: null,
  equipped_items: [],
  inventory: [],
  faction_id: null,
  lastSeenAt: null,
}

const KAEL: NewEntity = {
  id: 'char_kael',
  branchId: 'b1',
  kind: 'character',
  name: 'Kael',
  status: 'active',
  injectionMode: 'auto',
  state: STATE,
  createdAt: 1,
  updatedAt: 1,
}

const delta = (id: string, logPosition: number, over: Partial<Delta> = {}): Delta => ({
  id,
  branchId: 'b1',
  entryId: null,
  actionId: `act_${id}`,
  logPosition,
  source: 'user_edit',
  targetTable: 'entities',
  targetId: 'char_kael',
  op: 'update',
  undoPayload: null,
  encodingVersion: 1,
  createdAt: logPosition,
  ...over,
})

const ENTITY_ROW = { table: entities, idCol: entities.id, branchCol: entities.branchId }

export const kaelFrom = (fromLogPosition: number, branchId = 'b1'): ChainSnapshotArgs => ({
  branchId,
  targetId: 'char_kael',
  fromLogPosition,
  row: ENTITY_ROW,
})

export async function seedChainSnapshot(
  t: Awaited<ReturnType<typeof createTestDb>>,
): Promise<void> {
  // Unordered reads come back reversed, so only the read's ORDER BY yields the chain oldest first.
  t.sqlite.exec('PRAGMA reverse_unordered_selects = ON')
  await t.db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await t.db.insert(branches).values([
    { id: 'b1', storyId: 's1', name: 'main', createdAt: 1 },
    { id: 'b2', storyId: 's1', name: 'fork', createdAt: 1 },
  ])
  await t.db.insert(entities).values([KAEL, { ...KAEL, branchId: 'b2', name: 'Kael of the fork' }])
  await t.db.insert(characterRelationships).values({
    id: 'rel_1',
    branchId: 'b1',
    aId: 'char_kael',
    bId: 'char_mira',
    kind: 'rival',
    inverseKind: 'wary',
    createdAt: 1,
    updatedAt: 1,
  })
  // In log order: a reversed scan of the chain index or the rowid alike reads newest first.
  await t.db.insert(deltas).values([
    delta('d_create', 1, { op: 'create' }),
    delta('d_create', 1, { branchId: 'b2', op: 'create' }),
    delta('d_traits', 2, { undoPayload: { state: { traits: ['brave'] } } }),
    delta('d_fork', 2, { branchId: 'b2', undoPayload: { name: 'Kael' } }),
    delta('d_lore', 3, { targetTable: 'lore', undoPayload: { title: 'Kael' } }),
    delta('d_voice', 4, { undoPayload: { state: { voice: 'hoarse' } } }),
    delta('d_rel', 5, {
      targetTable: 'character_relationships',
      targetId: 'rel_1',
      undoPayload: { kind: 'friend' },
    }),
  ])
}
