import { eq } from 'drizzle-orm'

import {
  assertKnownSettingsKeys,
  setSettingsKeysOps,
  stories,
  storySettingsPartialSchema,
  storySettingsSchema,
  type DbCtx,
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

export type UpdateStorySettingsResult =
  | { status: 'ok'; settings: StorySettings }
  | { status: 'rejected'; reason: 'generation in flight' }

// `stories` is absent from deltas.target_table, so a settings save is a direct
// write: no delta row, no CTRL-Z reversal.
// See docs/data-model.md#diagram (deltas).
/**
 * @param patch - Shallow-merged onto the stored settings. Every value is
 * replaced wholesale, nested objects and arrays included; a key whose value is
 * `undefined` is left untouched. Pass only the changed keys — the write touches
 * exactly the keys passed, so an unchanged key spread in is still written and
 * can lose a concurrent edit to it. Unknown keys reject rather than being
 * silently dropped. Corruption is detected on the read-back _after_ the write:
 * a save whose own keys make the blob readable again succeeds, and one whose
 * keys do not still persists its write and bumps `updated_at` before throwing —
 * so the caller reports a failed save for a write that actually landed.
 */
export async function updateStorySettings(
  storyId: string,
  patch: Partial<StorySettings>,
  ctx: DbCtx,
  nowMs: number = Date.now(),
): Promise<UpdateStorySettingsResult> {
  if (generationStore.isUserEditBlocked()) {
    return { status: 'rejected', reason: 'generation in flight' }
  }
  // Explicit `undefined` typechecks without exactOptionalPropertyTypes and survives
  // the partial parse as a key with no bindable SQL form, so it must be dropped here.
  const changed = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  )
  // `Partial<StorySettings>` is a compile-time claim only, and must run before the
  // parse below, which strips unknown keys so the builder's own guard never sees them.
  assertKnownSettingsKeys(Object.keys(changed))
  const validated = storySettingsPartialSchema.parse(changed)

  await ctx.runInTransaction(setSettingsKeysOps(storyId, validated, nowMs))

  const [row] = await ctx.db
    .select({ settings: stories.settings })
    .from(stories)
    .where(eq(stories.id, storyId))
  if (!row) throw new Error('Story not found')

  const stored = storySettingsSchema.safeParse(row.settings)
  if (!stored.success) {
    // Surfaces the repair affordance `resetStorySettings` clears, rather than
    // dead-ending on a generic save error every retry reproduces.
    storiesStore.setOpenFailure({ storyId, kind: 'settings-corrupt' })
    throw new Error('Story settings could not be read', { cause: stored.error })
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
