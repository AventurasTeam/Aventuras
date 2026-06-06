import { sql } from 'drizzle-orm'
import {
  type AnySQLiteColumn,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'

import type { StoryDefinition, StorySettings } from './story-config-schema'
import type { ClassifierStatus } from '../world-json-types'

export const stories = sqliteTable('stories', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  tags: text('tags', { mode: 'json' })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  coverAssetId: text('cover_asset_id'),
  accentColor: text('accent_color'),
  status: text('status', { enum: ['draft', 'active', 'archived'] })
    .notNull()
    .default('draft'),
  favorite: integer('favorite').notNull().default(0),
  lastOpenedAt: integer('last_opened_at'),
  definition: text('definition', { mode: 'json' }).$type<StoryDefinition>(),
  settings: text('settings', { mode: 'json' }).$type<StorySettings>(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  // FK-less on purpose: breaks the stories<->branches cycle so a story can be
  // inserted before its first branch. Logically references branches.id.
  currentBranchId: text('current_branch_id'),
})

export const branches = sqliteTable('branches', {
  id: text('id').primaryKey(),
  storyId: text('story_id')
    .notNull()
    .references(() => stories.id),
  parentBranchId: text('parent_branch_id').references((): AnySQLiteColumn => branches.id),
  forkEntryId: text('fork_entry_id'),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
  classifierStatus: text('classifier_status', { mode: 'json' }).$type<ClassifierStatus>(),
})

export const branchEraFlips = sqliteTable(
  'branch_era_flips',
  {
    id: text('id').notNull(),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    atWorldtime: integer('at_worldtime').notNull(),
    eraName: text('era_name').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.branchId, t.id] })],
)
