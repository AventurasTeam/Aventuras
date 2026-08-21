import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { INJECTION_MODES } from '../enums'
import { branches } from '../stories/stories.table'

export const lore = sqliteTable(
  'lore',
  {
    id: text('id').notNull(),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    title: text('title').notNull(),
    body: text('body'),
    category: text('category'),
    tags: text('tags', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    keywords: text('keywords', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    injectionMode: text('injection_mode', { enum: INJECTION_MODES }).notNull(),
    priority: integer('priority').notNull().default(0),
    embeddingStale: integer('embedding_stale').notNull().default(1).$type<0 | 1>(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.branchId, t.id] }),
    index('lore_stale_idx')
      .on(t.branchId)
      .where(sql`${t.embeddingStale} = 1`),
  ],
)
