import { eq } from 'drizzle-orm'

import {
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
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { kickStoryDrain } from '@/lib/embedder-swap'
import {
  chaptersStore,
  characterRelationshipsStore,
  currentStoryStore,
  entitiesStore,
  entriesStore,
  happeningAwarenessStore,
  happeningInvolvementsStore,
  happeningsStore,
  loreStore,
  navigationStore,
  rehydrateStories,
  storiesStore,
  threadsStore,
  type OpenFailureKind,
  type OpenStory,
} from '@/lib/stores'

import { readRecentEntries } from '../story-entries/recent-window'
import type { DbCtx } from '../types'

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

// Single place every story-open path (landing, wizard, deep link) shares, so hydration and
// currentStoryStore updates stay in lockstep across them.
async function loadAndPublish(
  branchId: string,
  ctx: DbCtx,
  isCurrentRequest: IsCurrentRequest,
  publish: (open: OpenStory) => void,
): Promise<LoadOpenStoryResult> {
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
  const chapterRows = await ctx.db.select().from(chapters).where(eq(chapters.branchId, branchId))
  if (!isCurrentRequest()) return { status: 'cancelled' }
  const relationshipRows = await ctx.db
    .select()
    .from(characterRelationships)
    .where(eq(characterRelationships.branchId, branchId))
  if (!isCurrentRequest()) return { status: 'cancelled' }

  storiesStore.clearOpenFailure(row.storyId)
  entriesStore.hydrate(branchId, entryRows)
  entitiesStore.hydrate(branchId, entityRows)
  loreStore.hydrate(branchId, loreRows)
  threadsStore.hydrate(branchId, threadRows)
  happeningsStore.hydrate(branchId, happeningRows)
  happeningInvolvementsStore.hydrate(branchId, involvementRows)
  happeningAwarenessStore.hydrate(branchId, awarenessRows)
  chaptersStore.hydrate(branchId, chapterRows)
  characterRelationshipsStore.hydrate(branchId, relationshipRows)
  publish({ storyId: row.storyId, branchId, definition, settings })
  // Warm the vec cache for a story opened with pre-existing stale rows; no-op
  // until boot wires the drain controller, and the sync stage owns correctness.
  kickStoryDrain(row.storyId)
  return { status: 'ok', storyId: row.storyId, branchId }
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
