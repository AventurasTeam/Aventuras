import {
  blob,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

import { branches } from '../stories/stories.table'

export const probeCaptures = sqliteTable(
  'probe_captures',
  {
    id: text('id').notNull(),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    targetEntryId: text('target_entry_id').notNull(),
    capturedAt: integer('captured_at').notNull(),
    captureMode: text('capture_mode', { enum: ['light', 'deep'] }).notNull(),
    embeddingModelId: text('embedding_model_id'),
    failureReason: text('failure_reason'),
    // Raw gzipped-JSON bytes; the app (de)compresses around this BLOB. Typed as
    // bytes (not the decoded ProbeCapturePayload) so writers/readers can't skip
    // the (de)compression boundary.
    payload: blob('payload').$type<Uint8Array>(),
    payloadSize: integer('payload_size'),
  },
  (t) => [primaryKey({ columns: [t.branchId, t.id] })],
)

export const vaultCalendars = sqliteTable('vault_calendars', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  definition: text('definition', { mode: 'json' }).$type<Record<string, unknown>>(),
  favorite: integer('favorite').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const pipelineRuns = sqliteTable('pipeline_runs', {
  runId: text('run_id').primaryKey(),
  kind: text('kind').notNull(),
  actionId: text('action_id').notNull(),
  storyId: text('story_id'),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
  outcome: text('outcome', { enum: ['completed', 'aborted', 'failed', 'recovered'] }),
})

export const deltas = sqliteTable(
  'deltas',
  {
    id: text('id').primaryKey(),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    // FK-less: story_entries has a composite PK (branch_id, id); a single-column
    // FK is impossible. Null for non-entry-triggered actions.
    entryId: text('entry_id'),
    actionId: text('action_id').notNull(),
    logPosition: integer('log_position').notNull(),
    source: text('source', {
      enum: [
        'ai_classifier',
        'piggyback_tagged_block',
        'per_turn_classifier',
        'periodic_classifier',
        'user_edit',
        'lore_agent',
        'chapter_close',
      ],
    }).notNull(),
    // Free text validated by the C1 runtime registry; an enum would re-couple
    // every new delta-logged table to the schema.
    targetTable: text('target_table').notNull(),
    targetId: text('target_id').notNull(),
    op: text('op', { enum: ['create', 'update', 'delete'] }).notNull(),
    undoPayload: text('undo_payload', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    encodingVersion: integer('encoding_version').notNull().default(1),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('deltas_chain_idx').on(t.branchId, t.targetId, t.logPosition),
    uniqueIndex('deltas_log_position_uniq').on(t.branchId, t.logPosition),
  ],
)
