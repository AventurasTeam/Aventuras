import { eq, getTableColumns, sql } from 'drizzle-orm'

import {
  branchEraFlips,
  branches,
  chapters,
  characterRelationships,
  entities,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  lore,
  storyDefinitionSchema,
  storySettingsSchema,
  stories,
  threads,
  translations,
  type StoryDefinition,
  type StorySettings,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { kickStoryDrain } from '@/lib/embedder-swap'
import {
  chaptersStore,
  characterRelationshipsStore,
  closeReportFields,
  currentStoryStore,
  entitiesStore,
  entriesStore,
  eraFlipsStore,
  happeningAwarenessStore,
  happeningInvolvementsStore,
  happeningsStore,
  loreStore,
  navigationStore,
  rehydrateStories,
  storiesStore,
  threadsStore,
  translationsStore,
  type OpenFailureKind,
  type OpenStory,
} from '@/lib/stores'
import { warmTokenEncoder } from '@/lib/tokens'

import { readRecentEntries } from '../story-entries/recent-window'
import type { DbCtx } from '../types'
import { awaitRunningSwitch } from './switch-in-flight'

const TOKEN_WARM_TIMEOUT_MS = 2_000

export async function setStoryFavorite(id: string, favorite: boolean, ctx: DbCtx): Promise<void> {
  await ctx.runInTransaction([
    ctx.db
      .update(stories)
      .set({ favorite: favorite ? 1 : 0 })
      .where(eq(stories.id, id))
      .toSQL(),
  ])
  await rehydrateStories(ctx.db)
}

export async function setStoryArchived(id: string, archived: boolean, ctx: DbCtx): Promise<void> {
  const [row] = await ctx.db
    .select({ status: stories.status })
    .from(stories)
    .where(eq(stories.id, id))
  if (!row) throw new Error('Story not found')
  if (row?.status === 'draft') throw new Error('cannot archive a draft story')
  await ctx.runInTransaction([
    ctx.db
      .update(stories)
      .set({ status: archived ? 'archived' : 'active' })
      .where(eq(stories.id, id))
      .toSQL(),
  ])
  await rehydrateStories(ctx.db)
}

export async function touchStoryOpened(
  id: string,
  ctx: DbCtx,
  nowMs: number = Date.now(),
): Promise<void> {
  await ctx.runInTransaction([
    ctx.db.update(stories).set({ lastOpenedAt: nowMs }).where(eq(stories.id, id)).toSQL(),
  ])
  await rehydrateStories(ctx.db)
}

export type OpenStoryResult =
  | { status: 'ok'; branchId: string }
  | { status: 'no-branch' }
  | { status: 'open-failed'; kind: OpenFailureKind }
  | { status: 'cancelled' }

export type LoadOpenStoryResult =
  | { status: 'ok'; storyId: string; branchId: string }
  | { status: 'no-story' }
  | { status: 'failed'; kind: OpenFailureKind }
  | { status: 'cancelled' }

type IsCurrentRequest = () => boolean

const alwaysCurrent: IsCurrentRequest = () => true

// A string action only: json_extract alone reads an object action as its JSON text.
const REPORT_ACTION_ID = sql<string | null>`CASE json_type(${chapters.closeReport}, '$.actionId')
  WHEN 'text' THEN json_extract(${chapters.closeReport}, '$.actionId') END`

type Rows<S extends { hydrate: (branchId: string, rows: never) => void }> = Parameters<
  S['hydrate']
>[1]

export type BranchWorkingSet = {
  storyId: string
  definition: StoryDefinition
  settings: StorySettings
  entries: Rows<typeof entriesStore>
  entities: Rows<typeof entitiesStore>
  lore: Rows<typeof loreStore>
  threads: Rows<typeof threadsStore>
  happenings: Rows<typeof happeningsStore>
  involvements: Rows<typeof happeningInvolvementsStore>
  awareness: Rows<typeof happeningAwarenessStore>
  chapters: Rows<typeof chaptersStore>
  relationships: Rows<typeof characterRelationshipsStore>
  translations: Rows<typeof translationsStore>
  eraFlips: Rows<typeof eraFlipsStore>
}

export type ReadBranchResult =
  | { status: 'ok'; set: BranchWorkingSet }
  | { status: 'no-story' }
  | { status: 'failed'; kind: OpenFailureKind }
  | { status: 'cancelled' }

// The read half every branch load shares: it fills no store. A parse failure badges the story; a
// DB error throws.
export async function readBranchWorkingSet(
  branchId: string,
  ctx: DbCtx,
  isCurrentRequest: IsCurrentRequest,
): Promise<ReadBranchResult> {
  const [row] = await ctx.db
    .select({ storyId: stories.id, definition: stories.definition, settings: stories.settings })
    .from(branches)
    .innerJoin(stories, eq(stories.id, branches.storyId))
    .where(eq(branches.id, branchId))
  if (!isCurrentRequest()) return { status: 'cancelled' }
  if (!row) return { status: 'no-story' }

  let definition
  try {
    definition = storyDefinitionSchema.parse(row.definition)
  } catch (err) {
    if (!isCurrentRequest()) return { status: 'cancelled' }
    logger.error('action_layer.story_open_failed', {
      storyId: row.storyId,
      kind: 'definition-corrupt',
      error: err instanceof Error ? err.message : String(err),
    })
    storiesStore.setOpenFailure({ storyId: row.storyId, kind: 'definition-corrupt' })
    return { status: 'failed', kind: 'definition-corrupt' }
  }
  let settings
  try {
    settings = storySettingsSchema.parse(row.settings)
  } catch (err) {
    if (!isCurrentRequest()) return { status: 'cancelled' }
    logger.error('action_layer.story_open_failed', {
      storyId: row.storyId,
      kind: 'settings-corrupt',
      error: err instanceof Error ? err.message : String(err),
    })
    storiesStore.setOpenFailure({ storyId: row.storyId, kind: 'settings-corrupt' })
    return { status: 'failed', kind: 'settings-corrupt' }
  }

  const entryRows = await readRecentEntries(branchId, ctx.db)
  if (!isCurrentRequest()) return { status: 'cancelled' }
  const entityRows = await ctx.db.select().from(entities).where(eq(entities.branchId, branchId))
  if (!isCurrentRequest()) return { status: 'cancelled' }
  const loreRows = await ctx.db.select().from(lore).where(eq(lore.branchId, branchId))
  if (!isCurrentRequest()) return { status: 'cancelled' }
  // Plot and the Browse rail read these from the working set, not a direct query.
  const threadRows = await ctx.db.select().from(threads).where(eq(threads.branchId, branchId))
  if (!isCurrentRequest()) return { status: 'cancelled' }
  const happeningRows = await ctx.db
    .select()
    .from(happenings)
    .where(eq(happenings.branchId, branchId))
  if (!isCurrentRequest()) return { status: 'cancelled' }
  const involvementRows = await ctx.db
    .select()
    .from(happeningInvolvements)
    .where(eq(happeningInvolvements.branchId, branchId))
  if (!isCurrentRequest()) return { status: 'cancelled' }
  const awarenessRows = await ctx.db
    .select()
    .from(happeningAwareness)
    .where(eq(happeningAwareness.branchId, branchId))
  if (!isCurrentRequest()) return { status: 'cancelled' }
  // C4: the report stays out of chaptersStore, which keeps whether a row has one and its action.
  const { closeReport: _closeReport, ...chapterColumns } = getTableColumns(chapters)
  const chapterReads = await ctx.db
    .select({ ...chapterColumns, reportActionId: REPORT_ACTION_ID })
    .from(chapters)
    .where(eq(chapters.branchId, branchId))
  if (!isCurrentRequest()) return { status: 'cancelled' }
  const chapterRows = chapterReads.map(({ reportActionId, ...row }) => ({
    ...row,
    ...closeReportFields(reportActionId),
  }))
  const relationshipRows = await ctx.db
    .select()
    .from(characterRelationships)
    .where(eq(characterRelationships.branchId, branchId))
  if (!isCurrentRequest()) return { status: 'cancelled' }
  const translationRows = await ctx.db
    .select()
    .from(translations)
    .where(eq(translations.branchId, branchId))
  if (!isCurrentRequest()) return { status: 'cancelled' }
  const eraFlipRows = await ctx.db
    .select()
    .from(branchEraFlips)
    .where(eq(branchEraFlips.branchId, branchId))
  if (!isCurrentRequest()) return { status: 'cancelled' }

  return {
    status: 'ok',
    set: {
      storyId: row.storyId,
      definition,
      settings,
      entries: entryRows,
      entities: entityRows,
      lore: loreRows,
      threads: threadRows,
      happenings: happeningRows,
      involvements: involvementRows,
      awareness: awarenessRows,
      chapters: chapterRows,
      relationships: relationshipRows,
      translations: translationRows,
      eraFlips: eraFlipRows,
    },
  }
}

/** The eleven working-set hydrates, synchronous, in the load's order. */
export function fillWorkingSet(branchId: string, set: BranchWorkingSet): void {
  entriesStore.hydrate(branchId, set.entries)
  entitiesStore.hydrate(branchId, set.entities)
  loreStore.hydrate(branchId, set.lore)
  threadsStore.hydrate(branchId, set.threads)
  happeningsStore.hydrate(branchId, set.happenings)
  happeningInvolvementsStore.hydrate(branchId, set.involvements)
  happeningAwarenessStore.hydrate(branchId, set.awareness)
  chaptersStore.hydrate(branchId, set.chapters)
  characterRelationshipsStore.hydrate(branchId, set.relationships)
  translationsStore.hydrate(branchId, set.translations)
  eraFlipsStore.hydrate(branchId, set.eraFlips)
}

/** After a branch publishes: the drain kick, then the idle token-encoder warm-up. */
export function afterBranchPublished(storyId: string): void {
  // Warm the vec cache for a story opened with pre-existing stale rows; no-op
  // until boot wires the drain controller, and the sync stage owns correctness.
  kickStoryDrain(storyId)
  // Off the open's own task, so the encoder's build doesn't land on the first Send. React Native
  // has no real idle signal, so on Android it runs during the open, ahead of the reader's first
  // paint.
  globalThis.requestIdleCallback?.(warmTokenEncoder, { timeout: TOKEN_WARM_TIMEOUT_MS })
}

// Single place every story-open path (landing, wizard, deep link) shares, so hydration and
// currentStoryStore updates stay in lockstep across them.
async function loadAndPublish(
  branchId: string,
  ctx: DbCtx,
  isCurrentRequest: IsCurrentRequest,
  publish: (open: OpenStory) => void,
): Promise<LoadOpenStoryResult> {
  const read = await readBranchWorkingSet(branchId, ctx, isCurrentRequest)
  if (read.status !== 'ok') return read
  // Awaiting the read yields after its last check, so a request can go stale before the fill.
  if (!isCurrentRequest()) return { status: 'cancelled' }
  const { set } = read
  storiesStore.clearOpenFailure(set.storyId)
  fillWorkingSet(branchId, set)
  publish({ storyId: set.storyId, branchId, definition: set.definition, settings: set.settings })
  afterBranchPublished(set.storyId)
  return { status: 'ok', storyId: set.storyId, branchId }
}

// Route hydration (reload, deep link, branch switch): re-publishes without marking an open.
export function loadOpenStory(
  branchId: string,
  ctx: DbCtx,
  isCurrentRequest: IsCurrentRequest = alwaysCurrent,
): Promise<LoadOpenStoryResult> {
  return loadAndPublish(branchId, ctx, isCurrentRequest, currentStoryStore.set)
}

export async function openStory(
  id: string,
  ctx: DbCtx,
  navigate: (branchId: string) => void,
  nowMs: number = Date.now(),
  isCurrentRequest: IsCurrentRequest = alwaysCurrent,
): Promise<OpenStoryResult> {
  // An abandoned or failed switch puts the pointer back before it settles.
  await awaitRunningSwitch()
  const [row] = await ctx.db
    .select({ branchId: stories.currentBranchId })
    .from(stories)
    .where(eq(stories.id, id))
  if (!isCurrentRequest()) return { status: 'cancelled' }
  const branchId = row?.branchId ?? null
  if (branchId == null) return { status: 'no-branch' }

  const load = await loadAndPublish(branchId, ctx, isCurrentRequest, currentStoryStore.open)
  if (load.status === 'cancelled') return load
  if (load.status === 'failed') return { status: 'open-failed', kind: load.kind }
  if (load.status !== 'ok') return { status: 'no-branch' }

  if (!isCurrentRequest()) return { status: 'cancelled' }
  navigationStore.setCurrentStory(id)
  navigationStore.setCurrentBranch(branchId)
  if (!isCurrentRequest()) return { status: 'cancelled' }
  navigate(branchId)
  if (!isCurrentRequest()) return { status: 'cancelled' }
  await touchStoryOpened(id, ctx, nowMs).catch((err: unknown) => {
    logger.error('action_layer.story_touch_failed', {
      storyId: id,
      error: err instanceof Error ? err.message : String(err),
    })
  })
  return { status: 'ok', branchId }
}
