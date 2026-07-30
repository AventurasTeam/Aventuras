import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { INJECTION_MODES } from '../enums'
import { branches } from '../stories/stories.table'

export const threads = sqliteTable(
  'threads',
  {
    id: text('id').notNull(),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    title: text('title').notNull(),
    description: text('description'),
    category: text('category'),
    icon: text('icon'),
    status: text('status', { enum: ['pending', 'active', 'resolved', 'failed'] }).notNull(),
    injectionMode: text('injection_mode', { enum: INJECTION_MODES }).notNull(),
    triggeredAtEntryId: text('triggered_at_entry_id'),
    resolvedAtEntryId: text('resolved_at_entry_id'),
    embeddingStale: integer('embedding_stale').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.branchId, t.id] }),
    index('threads_stale_idx')
      .on(t.branchId)
      .where(sql`${t.embeddingStale} = 1`),
  ],
)
