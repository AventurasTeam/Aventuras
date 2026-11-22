import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'

import {
  branchEraFlips,
  chapters,
  characterRelationships,
  deltas,
  entities,
  entryAssets,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  lore,
  pipelineRuns,
  probeCaptures,
  reversalJournals,
  storyEntries,
  threads,
  translations,
} from '../schema'

export type CopyMode = 'fork' | 'duplicate'

/**
 * `copy-non-system` and `copy-survivors` name the filter a fork applies (no `kind = 'system'`
 * entries; only the deltas and journals its rewind keeps); the fork's caller passes it as the
 * table's predicate.
 */
export type ForkCopy = 'copy' | 'copy-non-system' | 'copy-survivors' | 'skip'
export type DuplicateCopy = 'copy' | 'skip'

export type BranchCopyTable = SQLiteTable & { branchId: SQLiteColumn }

export type BranchCopyTableName =
  | 'story_entries'
  | 'entities'
  | 'character_relationships'
  | 'lore'
  | 'threads'
  | 'happenings'
  | 'happening_involvements'
  | 'happening_awareness'
  | 'chapters'
  | 'branch_era_flips'
  | 'translations'
  | 'entry_assets'
  | 'probe_captures'
  | 'pipeline_runs'
  | 'deltas'
  | 'reversal_journals'

export type ManifestRow = {
  readonly table: BranchCopyTable
  readonly fork: ForkCopy
  readonly duplicate: DuplicateCopy
}

/**
 * data-model.md → Branch model's manifest, in copy order: a fork's predicate may read a table
 * copied earlier in the batch, so deltas and journals copy after every domain table.
 */
export const BRANCH_COPY_MANIFEST: Readonly<Record<BranchCopyTableName, ManifestRow>> = {
  story_entries: { table: storyEntries, fork: 'copy-non-system', duplicate: 'copy' },
  entities: { table: entities, fork: 'copy', duplicate: 'copy' },
  character_relationships: { table: characterRelationships, fork: 'copy', duplicate: 'copy' },
  lore: { table: lore, fork: 'copy', duplicate: 'copy' },
  threads: { table: threads, fork: 'copy', duplicate: 'copy' },
  happenings: { table: happenings, fork: 'copy', duplicate: 'copy' },
  happening_involvements: { table: happeningInvolvements, fork: 'copy', duplicate: 'copy' },
  happening_awareness: { table: happeningAwareness, fork: 'copy', duplicate: 'copy' },
  chapters: { table: chapters, fork: 'copy', duplicate: 'copy' },
  branch_era_flips: { table: branchEraFlips, fork: 'copy', duplicate: 'copy' },
  translations: { table: translations, fork: 'copy', duplicate: 'copy' },
  entry_assets: { table: entryAssets, fork: 'copy', duplicate: 'copy' },
  // probe.md → Branch fork: a capture means something only against the pool it was written over.
  probe_captures: { table: probeCaptures, fork: 'skip', duplicate: 'skip' },
  // A run's marker belongs to the branch it ran on, and run_id is a global key.
  pipeline_runs: { table: pipelineRuns, fork: 'skip', duplicate: 'skip' },
  deltas: { table: deltas, fork: 'copy-survivors', duplicate: 'copy' },
  reversal_journals: { table: reversalJournals, fork: 'copy-survivors', duplicate: 'copy' },
}

/** The tables a fork must filter, so the copier requires a predicate for each. */
export type ForkFilteredTable = 'story_entries' | 'deltas' | 'reversal_journals'
