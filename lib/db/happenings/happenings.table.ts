import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

import { branches } from '../stories/stories.table'

export const happenings = sqliteTable(
  'happenings',
  {
    id: text('id').notNull(),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    title: text('title').notNull(),
    description: text('description'),
    category: text('category'),
    icon: text('icon'),
    temporal: text('temporal'),
    occurredAtEntryId: text('occurred_at_entry_id'),
    commonKnowledge: integer('common_knowledge').notNull().default(0),
    embeddingStale: integer('embedding_stale').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.branchId, t.id] }),
    check('happenings_mutual_excl', sql`${t.occurredAtEntryId} IS NULL OR ${t.temporal} IS NULL`),
    index('happenings_stale_idx')
      .on(t.branchId)
      .where(sql`${t.embeddingStale} = 1`),
  ],
)

export const happeningInvolvements = sqliteTable(
  'happening_involvements',
  {
    id: text('id').notNull(),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    // FK-less: happenings has a composite PK (branch_id, id); a single-column FK is impossible.
    happeningId: text('happening_id').notNull(),
    // FK-less: entities has a composite PK (branch_id, id); a single-column FK is impossible.
    entityId: text('entity_id').notNull(),
    role: text('role'),
  },
  (t) => [primaryKey({ columns: [t.branchId, t.id] })],
)

export const happeningAwareness = sqliteTable(
  'happening_awareness',
  {
    id: text('id').notNull(),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    // FK-less: happenings has a composite PK (branch_id, id); a single-column FK is impossible.
    happeningId: text('happening_id').notNull(),
    // FK-less: entities has a composite PK (branch_id, id); a single-column FK is impossible.
    characterId: text('character_id').notNull(),
    learnedAtEntryId: text('learned_at_entry_id'),
    decayResistance: real('decay_resistance'),
    retrievalCount: integer('retrieval_count').notNull().default(0),
    source: text('source'),
  },
  (t) => [
    primaryKey({ columns: [t.branchId, t.id] }),
    uniqueIndex('haw_natural_uniq').on(t.branchId, t.characterId, t.happeningId),
  ],
)
