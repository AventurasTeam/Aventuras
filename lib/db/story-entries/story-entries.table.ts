import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import type { EntryMetadata } from './entry-metadata'
import { branches } from '../stories/stories.table'

export const storyEntries = sqliteTable(
  'story_entries',
  {
    // id is branch-scoped (unique within a branch, not globally) — the composite PK enforces it.
    id: text('id').notNull(),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    position: integer('position').notNull(),
    kind: text('kind', { enum: ['user_action', 'ai_reply', 'system', 'opening'] }).notNull(),
    content: text('content').notNull(),
    chapterId: text('chapter_id'),
    metadata: text('metadata', { mode: 'json' }).$type<EntryMetadata>(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.branchId, t.id] }),
    // Leading branch_id lets the ordered prompt-buffer reads seek this index
    // directly; the composite PK is keyed on id, so position sorts unindexed.
    index('story_entries_position_idx').on(t.branchId, t.position),
  ],
)

export const chapters = sqliteTable(
  'chapters',
  {
    id: text('id').notNull(),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    sequenceNumber: integer('sequence_number').notNull(),
    // A row exists only for a closed chapter, and chapter-close populates
    // every field at close — placeholder content on LLM failure, never NULL
    // (docs/memory/chapter-close.md) — so none of these are nullable.
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    theme: text('theme').notNull(),
    keywords: text('keywords', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    startEntryId: text('start_entry_id').notNull(),
    endEntryId: text('end_entry_id').notNull(),
    tokenCount: integer('token_count').notNull(),
    closedAt: integer('closed_at').notNull(),
    embeddingStale: integer('embedding_stale').notNull().default(1).$type<0 | 1>(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.branchId, t.id] }),
    index('chapters_stale_idx')
      .on(t.branchId)
      .where(sql`${t.embeddingStale} = 1`),
  ],
)
