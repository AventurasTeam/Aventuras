import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

import { INJECTION_MODES } from '../enums'
import type { EntityState } from './entities-types'
import { branches } from '../stories/stories.table'

export const entities = sqliteTable(
  'entities',
  {
    id: text('id').notNull(),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    kind: text('kind', { enum: ['character', 'location', 'item', 'faction'] }).notNull(),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status', { enum: ['staged', 'active', 'retired'] }).notNull(),
    retiredReason: text('retired_reason'),
    injectionMode: text('injection_mode', { enum: INJECTION_MODES }).notNull(),
    nameCollisionFlag: integer('name_collision_flag').notNull().default(0),
    state: text('state', { mode: 'json' }).$type<EntityState>(),
    tags: text('tags', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    embeddingStale: integer('embedding_stale').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.branchId, t.id] }),
    index('entities_stale_idx')
      .on(t.branchId)
      .where(sql`${t.embeddingStale} = 1`),
  ],
)

export const characterRelationships = sqliteTable(
  'character_relationships',
  {
    id: text('id').notNull(),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    aId: text('a_id').notNull(),
    bId: text('b_id').notNull(),
    kind: text('kind'),
    inverseKind: text('inverse_kind'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.branchId, t.id] }),
    check('char_rel_canonical_order', sql`${t.aId} < ${t.bId}`),
    check('char_rel_one_pov', sql`${t.kind} IS NOT NULL OR ${t.inverseKind} IS NOT NULL`),
    uniqueIndex('char_rel_pair_uniq').on(t.branchId, t.aId, t.bId),
    index('char_rel_branch_a_idx').on(t.branchId, t.aId),
    index('char_rel_branch_b_idx').on(t.branchId, t.bId),
  ],
)
