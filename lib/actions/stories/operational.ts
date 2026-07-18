import { desc, eq } from 'drizzle-orm'

import {
  branches,
  entities,
  storyDefinitionSchema,
  storyEntries,
  storySettingsSchema,
  stories,
  type StoryEntry,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import {
  currentStoryStore,
  entitiesStore,
  entriesStore,
  navigationStore,
  rehydrateStories,
  storiesStore,
  type OpenFailureKind,
} from '@/lib/stores'

import type { DbCtx } from '../types'

const OPEN_WINDOW_SIZE = 50

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

// Parses the story's config JSON, hydrates the working-set stores the per-turn
// loop reads (entries + entities), and populates currentStoryStore — the single
// place that does all three, so any story-open path (landing, wizard finish,
// future deep-link) gets the same guarantees a corrupt-JSON badge included.
export async function loadOpenStory(
  branchId: string,
  ctx: DbCtx,
  isCurrentRequest: IsCurrentRequest = alwaysCurrent,
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

  const entryRows = (await ctx.db
    .select()
    .from(storyEntries)
    .where(eq(storyEntries.branchId, branchId))
    .orderBy(desc(storyEntries.position))
    .limit(OPEN_WINDOW_SIZE)) as StoryEntry[]
  if (!isCurrentRequest()) return { status: 'cancelled' }
  const entityRows = await ctx.db.select().from(entities).where(eq(entities.branchId, branchId))
  if (!isCurrentRequest()) return { status: 'cancelled' }

  storiesStore.clearOpenFailure(row.storyId)
  entriesStore.hydrate(branchId, entryRows.reverse())
  entitiesStore.hydrate(branchId, entityRows)
  currentStoryStore.set({ storyId: row.storyId, branchId, definition, settings })
  return { status: 'ok', storyId: row.storyId, branchId }
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

  const load = await loadOpenStory(branchId, ctx, isCurrentRequest)
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
