import { sql } from 'drizzle-orm'
import {
  type AnySQLiteColumn,
  blob,
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

import type {
  AppSettingsDiagnostics,
  ModelProfile,
  ProviderInstance,
} from './app-settings/app-settings-schema'
import type { EntityState } from './entities-types'
import type { EntryMetadata } from './entry-metadata'
import type {
  Appearance,
  StoryDefinition,
  StorySettings,
  SuggestionCategory,
} from './story-config/story-settings-types'
import type { ClassifierStatus } from './world-json-types'

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
  (t) => [primaryKey({ columns: [t.branchId, t.id] })],
)

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
    injectionMode: text('injection_mode', { enum: ['always', 'auto', 'disabled'] }).notNull(),
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
  (t) => [primaryKey({ columns: [t.branchId, t.id] })],
)

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
    injectionMode: text('injection_mode', { enum: ['always', 'auto', 'disabled'] }).notNull(),
    priority: integer('priority').notNull().default(0),
    embeddingStale: integer('embedding_stale').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.branchId, t.id] })],
)

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
    injectionMode: text('injection_mode', { enum: ['always', 'auto', 'disabled'] }).notNull(),
    triggeredAtEntryId: text('triggered_at_entry_id'),
    resolvedAtEntryId: text('resolved_at_entry_id'),
    embeddingStale: integer('embedding_stale').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.branchId, t.id] })],
)

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
    embeddingStale: integer('embedding_stale').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.branchId, t.id] })],
)

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

export const translations = sqliteTable(
  'translations',
  {
    id: text('id').notNull(),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    targetKind: text('target_kind', {
      enum: [
        'entity',
        'lore',
        'thread',
        'happening',
        'story_entry',
        'character_relationship',
        'chapter',
      ],
    }).notNull(),
    targetId: text('target_id').notNull(),
    field: text('field').notNull(),
    language: text('language').notNull(),
    translatedText: text('translated_text'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.branchId, t.id] }),
    uniqueIndex('translations_natural_uniq').on(
      t.branchId,
      t.targetKind,
      t.targetId,
      t.field,
      t.language,
    ),
  ],
)

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

export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['image', 'audio', 'file'] }).notNull(),
  mimeType: text('mime_type'),
  filePath: text('file_path').notNull(),
  sizeBytes: integer('size_bytes'),
  contentHash: text('content_hash'),
  createdAt: integer('created_at').notNull(),
  pendingDeleteAt: integer('pending_delete_at'),
})

export const entryAssets = sqliteTable(
  'entry_assets',
  {
    id: text('id').notNull(),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    // FK-less: story_entries has a composite PK (branch_id, id); a single-column FK is impossible.
    entryId: text('entry_id').notNull(),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id),
    role: text('role'),
    position: integer('position'),
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

export const appSettings = sqliteTable('app_settings', {
  id: text('id').primaryKey(),
  providers: text('providers', { mode: 'json' })
    .$type<ProviderInstance[]>()
    .notNull()
    .default(sql`'[]'`),
  profiles: text('profiles', { mode: 'json' })
    .$type<ModelProfile[]>()
    .notNull()
    .default(sql`'[]'`),
  assignments: text('assignments', { mode: 'json' })
    .$type<Record<string, string>>()
    .notNull()
    .default(sql`'{}'`),
  defaultProviderId: text('default_provider_id'),
  embeddingModelId: text('embedding_model_id'),
  embeddingProviderId: text('embedding_provider_id'),
  defaultStorySettings: text('default_story_settings', { mode: 'json' })
    .$type<Partial<StorySettings>>()
    .notNull()
    .default(sql`'{}'`),
  defaultCalendarId: text('default_calendar_id'),
  defaultSuggestionCategories: text('default_suggestion_categories', { mode: 'json' })
    .$type<{ adventure: SuggestionCategory[]; creative: SuggestionCategory[] }>()
    .notNull()
    .default(sql`'{"adventure":[],"creative":[]}'`),
  appearance: text('appearance', { mode: 'json' })
    .$type<Appearance>()
    .notNull()
    .default(sql`'{}'`),
  uiLanguage: text('ui_language'),
  onboardingCompletedAt: integer('onboarding_completed_at'),
  diagnostics: text('diagnostics', { mode: 'json' })
    .$type<AppSettingsDiagnostics>()
    .notNull()
    .default(sql`'{"enabled":false,"debug_level_enabled":false}'`),
  // Constant default (not unixepoch()) so `ALTER TABLE ... ADD ... NOT NULL`
  // stays valid on an already-seeded singleton — SQLite rejects a non-constant
  // default when adding a column to a populated table. The real timestamp comes
  // from the caller (ensureAppSettingsSingleton), as with every other table.
  createdAt: integer('created_at').notNull().default(0),
  updatedAt: integer('updated_at').notNull().default(0),
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
      enum: ['ai_classifier', 'periodic_classifier', 'user_edit', 'lore_agent', 'chapter_close'],
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

export const dbSchema = {
  stories,
  branches,
  storyEntries,
  entities,
  lore,
  threads,
  happenings,
  happeningInvolvements,
  happeningAwareness,
  characterRelationships,
  chapters,
  branchEraFlips,
  translations,
  probeCaptures,
  assets,
  entryAssets,
  vaultCalendars,
  appSettings,
  pipelineRuns,
  deltas,
}
