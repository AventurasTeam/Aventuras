import { eq } from 'drizzle-orm'

import {
  assertKnownSettingsKeys,
  setSettingsKeysOps,
  setStoryInfoOps,
  stories,
  storySettingsPartialSchema,
  storySettingsSchema,
  type DbCtx,
  type StoryInfoPatch,
  type StorySettings,
} from '@/lib/db'
import { currentStoryStore, generationStore, rehydrateStories, storiesStore } from '@/lib/stores'

/**
 * The write landed but the store could not be re-read, so every rendered copy
 * of these settings is stale. Distinct from a failed save: the caller must not
 * tell the user their changes were lost.
 */
export class StorySettingsStaleStoreError extends Error {
  constructor() {
    super('Story settings were saved but the store could not be refreshed')
    this.name = 'StorySettingsStaleStoreError'
  }
}

/**
 * The write landed and the store is current, but the resulting blob fails the
 * schema, so the surface cannot render it. Also distinct from a failed save:
 * retrying reproduces it, and the columns the same save wrote are on disk.
 */
export class StorySettingsUnreadableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('Story settings were saved but can no longer be read', options)
    this.name = 'StorySettingsUnreadableError'
  }
}

export type UpdateStorySettingsResult =
  | { status: 'ok'; settings: StorySettings }
  | { status: 'rejected'; reason: 'generation in flight' | 'draft story' }

/** One Story Settings save: the settings JSON keys and the `stories` columns it touches. */
export type StorySettingsSessionPatch = {
  settings?: Partial<StorySettings>
  columns?: StoryInfoPatch
}

function settingsOps(storyId: string, patch: Partial<StorySettings>, nowMs: number) {
  // Explicit `undefined` typechecks without exactOptionalPropertyTypes and survives
  // the partial parse as a key with no bindable SQL form, so it must be dropped here.
  const changed = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  )
  // `Partial<StorySettings>` is a compile-time claim only, and must run before the
  // parse below, which strips unknown keys so the builder's own guard never sees them.
  assertKnownSettingsKeys(Object.keys(changed))
  return setSettingsKeysOps(storyId, storySettingsPartialSchema.parse(changed), nowMs)
}

// `stories` is absent from deltas.target_table, so a settings save is a direct
// write: no delta row, no CTRL-Z reversal.
// See docs/data-model.md#diagram (deltas).
/**
 * Commits the settings keys and the column patch as ONE transaction. Every
 * settings value is replaced wholesale; a key whose value is `undefined` is left
 * untouched; unknown keys reject rather than being silently dropped. Pass only
 * the changed keys and columns: an unchanged value spread in is still written
 * and can lose a concurrent edit to it. A column patch on a draft story is
 * refused; a settings-only patch goes through. Corruption is detected on the
 * read-back _after_ the write: a save whose own keys make the blob readable
 * again succeeds, and otherwise the write, column patch included, still commits
 * and bumps `updated_at` before the call throws.
 */
export async function saveStorySettingsSession(
  storyId: string,
  patch: StorySettingsSessionPatch,
  ctx: DbCtx,
  nowMs: number = Date.now(),
): Promise<UpdateStorySettingsResult> {
  const columnOps = patch.columns ? setStoryInfoOps(storyId, patch.columns, nowMs) : []
  if (columnOps.length > 0) {
    const [row] = await ctx.db
      .select({ status: stories.status })
      .from(stories)
      .where(eq(stories.id, storyId))
    if (!row) throw new Error('Story not found')
    if (row.status === 'draft') return { status: 'rejected', reason: 'draft story' }
  }
  // No await between this gate and the write, so a run starting mid-read cannot slip past.
  if (generationStore.isUserEditBlocked()) {
    return { status: 'rejected', reason: 'generation in flight' }
  }
  await ctx.runInTransaction([...settingsOps(storyId, patch.settings ?? {}, nowMs), ...columnOps])

  const [row] = await ctx.db
    .select({ settings: stories.settings })
    .from(stories)
    .where(eq(stories.id, storyId))
  if (!row) throw new Error('Story not found')

  const stored = storySettingsSchema.safeParse(row.settings)
  if (!stored.success) {
    // The write committed regardless, so the store must not keep pre-save columns.
    // A failed refresh logs and is deliberately not raised as the stale-store error
    // below: that copy sends the user to reload, which lands back on the unreadable
    // blob, where this path's error names the reset that actually repairs it.
    await rehydrateStories(ctx.db)
    // Surfaces the repair affordance `resetStorySettings` clears, rather than
    // dead-ending on a generic save error every retry reproduces.
    storiesStore.setOpenFailure({ storyId, kind: 'settings-corrupt' })
    throw new StorySettingsUnreadableError({ cause: stored.error })
  }
  const settings = stored.data

  // `rehydrateStories` swallows its own failure, so an unchecked call leaves
  // the store showing pre-save values while reporting a clean save.
  if (!(await rehydrateStories(ctx.db))) throw new StorySettingsStaleStoreError()
  // A save whose own keys repaired the blob leaves the flag an earlier failed
  // save set, and `attemptOpenStory` stays short-circuited on it.
  storiesStore.clearOpenFailure(storyId, 'settings-corrupt')
  const open = currentStoryStore.getCurrentStory()
  if (open?.storyId === storyId) currentStoryStore.set({ ...open, settings })
  return { status: 'ok', settings }
}

/** Settings-only form of `saveStorySettingsSession`. */
export function updateStorySettings(
  storyId: string,
  patch: Partial<StorySettings>,
  ctx: DbCtx,
  nowMs: number = Date.now(),
): Promise<UpdateStorySettingsResult> {
  return saveStorySettingsSession(storyId, { settings: patch }, ctx, nowMs)
}
