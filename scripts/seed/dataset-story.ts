import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getTableColumns, getTableName } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { createInsertSchema } from 'drizzle-zod'
import { z } from 'zod'

import { entryAssetWriteSchema } from '../../lib/db/assets/entry-assets-schema'
import type { SeedStep } from '../../lib/db/devtools/seed-dataset'
import { characterRelationshipWriteSchema } from '../../lib/db/entities/character-relationship-schema'
import { entityWriteSchema } from '../../lib/db/entities/entity-schema'
import {
  entityStateSchemaForKind,
  type EntityKind,
} from '../../lib/db/entities/entity-state-schema'
import { happeningAwarenessWriteSchema } from '../../lib/db/happenings/happening-awareness-schema'
import { happeningInvolvementWriteSchema } from '../../lib/db/happenings/happening-involvement-schema'
import { happeningWriteSchema } from '../../lib/db/happenings/happening-schema'
import { loreWriteSchema } from '../../lib/db/lore/lore-schema'
import {
  appSettings,
  assets,
  branchEraFlips,
  branches,
  chapters,
  characterRelationships,
  deltas,
  entities,
  entryAssets,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  lore,
  stories,
  storyEntries,
  threads,
  translations,
} from '../../lib/db/schema'
import { branchEraFlipWriteSchema } from '../../lib/db/stories/era-flip-schema'
import {
  storyDefinitionSchema,
  storySettingsSchema,
  type StorySettings,
} from '../../lib/db/stories/story-config-schema'
import { chapterWriteSchema } from '../../lib/db/story-entries/chapter-schema'
import { entryMetadataSchema } from '../../lib/db/story-entries/entry-metadata'
import { threadWriteSchema } from '../../lib/db/threads/thread-schema'
import { translationWriteSchema } from '../../lib/db/translations/translations-schema'

export const DATASET_SEED_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../dataset-chapter/treasure-island.seed.json',
)

type SeedTable = {
  table: SQLiteTable
  row: z.ZodObject
  /** The table's write schema, for the refinements the column types can't carry. */
  write?: z.ZodType
  order: SQLiteColumn[]
}

const stillStale = () => z.literal(1)

function seedTable(
  table: SQLiteTable,
  order: SQLiteColumn[],
  refine: Record<string, () => z.ZodType> = {},
  write?: z.ZodType,
): SeedTable {
  const columns = getTableColumns(table)
  const withStale = 'embeddingStale' in columns ? { embeddingStale: stillStale, ...refine } : refine
  return { table, row: createInsertSchema(table, withStale).strict(), write, order }
}

/** Insert order: a parent's table before its children's. */
export const DATASET_SEED_TABLES = [
  seedTable(stories, [stories.id], {
    definition: () => storyDefinitionSchema,
    settings: () => storySettingsSchema,
  }),
  seedTable(branches, [branches.createdAt, branches.id]),
  seedTable(storyEntries, [storyEntries.branchId, storyEntries.position], {
    metadata: () => entryMetadataSchema,
  }),
  seedTable(chapters, [chapters.branchId, chapters.sequenceNumber], {}, chapterWriteSchema),
  seedTable(entities, [entities.branchId, entities.id], {}, entityWriteSchema),
  seedTable(
    characterRelationships,
    [characterRelationships.branchId, characterRelationships.id],
    {},
    characterRelationshipWriteSchema,
  ),
  seedTable(lore, [lore.branchId, lore.id], {}, loreWriteSchema),
  seedTable(threads, [threads.branchId, threads.id], {}, threadWriteSchema),
  seedTable(happenings, [happenings.branchId, happenings.id], {}, happeningWriteSchema),
  seedTable(
    happeningInvolvements,
    [happeningInvolvements.branchId, happeningInvolvements.id],
    {},
    happeningInvolvementWriteSchema,
  ),
  seedTable(
    happeningAwareness,
    [happeningAwareness.branchId, happeningAwareness.id],
    {},
    happeningAwarenessWriteSchema,
  ),
  seedTable(
    branchEraFlips,
    [branchEraFlips.branchId, branchEraFlips.id],
    {},
    branchEraFlipWriteSchema,
  ),
  seedTable(translations, [translations.branchId, translations.id], {}, translationWriteSchema),
  seedTable(entryAssets, [entryAssets.branchId, entryAssets.id], {}, entryAssetWriteSchema),
  seedTable(deltas, [deltas.branchId, deltas.logPosition]),
].map((spec) => ({ ...spec, name: getTableName(spec.table) }))

/** The tables a story seed leaves out, and why: a new table fails the seed's test until listed. */
export const DATASET_SEED_LEFT_OUT: Record<string, string> = {
  app_settings: "app-level: the default seed's apply, and they hold provider keys",
  vault_calendars: "app-level: the default seed's apply",
  assets: "app-level, naming files outside the database: the default seed's apply",
  pipeline_runs: 'the run log; recovery reads only an unfinished run, and a seeded run is finished',
  probe_captures: "a probe's diagnostic captures, not story state",
  wizard_sessions: 'wizard drafts, which no finished story keeps',
}

type Row = Record<string, unknown>

function problem(where: string, error: unknown): Error {
  const detail = error instanceof z.ZodError ? z.prettifyError(error) : String(error)
  return new Error(`dataset seed ${where}: ${detail}`)
}

function validRow(spec: SeedTable & { name: string }, raw: unknown, index: number): Row {
  const where = `${spec.name}[${index}]`
  const parsed = spec.row.safeParse(raw)
  if (!parsed.success) throw problem(where, parsed.error)
  const checks: [z.ZodType | undefined, unknown][] = [[spec.write, parsed.data]]
  if (spec.table === entities && parsed.data.state != null)
    checks.push([entityStateSchemaForKind(parsed.data.kind as EntityKind), parsed.data.state])
  for (const [schema, value] of checks) {
    const result = schema?.safeParse(value)
    if (result && !result.success) throw problem(where, result.error)
  }
  return raw as Row
}

function namedProviders(settings: StorySettings): string[] {
  return [
    ...Object.values(settings.models).map((ref) => ref?.providerId),
    settings.embedding_provider_id,
    settings.embedding_swap_provider_id,
  ].filter((id): id is string => id !== undefined)
}

/** The app-level rows a story seed may name: the default seed's providers and assets. */
export type SeedAppRefs = { providerIds: ReadonlySet<string>; assetIds: ReadonlySet<string> }

export function seedAppRefs(steps: readonly SeedStep[]): SeedAppRefs {
  const rowsOf = <T>(table: SQLiteTable) =>
    steps.filter((s) => s.table === table).flatMap((s) => s.rows as T[])
  return {
    providerIds: new Set(
      rowsOf<typeof appSettings.$inferInsert>(appSettings).flatMap(
        (row) => row.providers?.map((p) => p.id) ?? [],
      ),
    ),
    assetIds: new Set(rowsOf<typeof assets.$inferInsert>(assets).map((row) => row.id)),
  }
}

/**
 * Validates a story seed and returns its insert steps, rows as written: no Zod default or strip
 * reaches the database, so an export of the loaded story reproduces the file.
 */
export function parseStorySeed(json: string, refs: SeedAppRefs): SeedStep[] {
  const seed = z.record(z.string(), z.array(z.unknown())).parse(JSON.parse(json))
  const names = DATASET_SEED_TABLES.map((spec) => spec.name)
  const unknown = Object.keys(seed).filter((name) => !names.includes(name))
  const missing = names.filter((name) => !(name in seed))
  if (unknown.length > 0 || missing.length > 0)
    throw new Error(
      `dataset seed tables: unknown ${JSON.stringify(unknown)}, missing ${JSON.stringify(missing)}`,
    )

  const steps = DATASET_SEED_TABLES.map((spec) => ({
    name: spec.name,
    table: spec.table,
    rows: seed[spec.name]!.map((raw, i) => validRow(spec, raw, i)),
  }))
  const rowsOf = (name: string) => steps.find((s) => s.name === name)!.rows as Row[]

  const [story, ...others] = rowsOf('stories')
  if (story === undefined || others.length > 0)
    throw new Error(`dataset seed stories: one story, got ${rowsOf('stories').length}`)
  for (const id of namedProviders(story.settings as StorySettings))
    if (!refs.providerIds.has(id))
      throw new Error(
        `dataset seed stories[0]: its settings name provider ${id}, which the default seed's app settings lack`,
      )
  const branchIds = new Set<unknown>()
  rowsOf('branches').forEach((branch, i) => {
    if (branch.storyId !== story.id) throw new Error(`dataset seed branches[${i}]: another story`)
    branchIds.add(branch.id)
  })
  const namedAssets: [string, unknown][] = [
    ['stories[0]', story.coverAssetId],
    ...rowsOf('entry_assets').map((row, i): [string, unknown] => [
      `entry_assets[${i}]`,
      row.assetId,
    ]),
  ]
  for (const [where, assetId] of namedAssets)
    if (assetId != null && !refs.assetIds.has(assetId as string))
      throw new Error(
        `dataset seed ${where}: names asset ${String(assetId)}, which the default seed lacks`,
      )
  if (story.currentBranchId != null && !branchIds.has(story.currentBranchId))
    throw new Error(
      `dataset seed stories[0]: current branch ${String(story.currentBranchId)} is not one of its branches`,
    )
  for (const { name } of DATASET_SEED_TABLES.slice(2))
    rowsOf(name).forEach((row, i) => {
      if (!branchIds.has(row.branchId))
        throw new Error(`dataset seed ${name}[${i}]: a branch outside the story`)
    })
  return steps
}

export function datasetStorySteps(refs: SeedAppRefs): SeedStep[] {
  return parseStorySeed(readFileSync(DATASET_SEED_PATH, 'utf8'), refs)
}
