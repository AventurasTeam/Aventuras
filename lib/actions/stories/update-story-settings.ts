import { eq } from 'drizzle-orm'

import {
  stories,
  storySettingsPartialSchema,
  storySettingsSchema,
  type DbCtx,
  type StorySettings,
} from '@/lib/db'
import { currentStoryStore, rehydrateStories, storiesStore } from '@/lib/stores'

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

// `stories` is absent from deltas.target_table, so a settings save is a direct
// write: no delta row, no CTRL-Z reversal.
// See docs/data-model.md#diagram (deltas).
/**
 * @param patch - Shallow-merged onto the stored settings. Every value is
 * replaced wholesale, nested objects and arrays included; a key whose value is
 * `undefined` is left untouched. Pass only the changed keys — spreading a whole
 * settings object in discards any concurrent write that the read picked up.
 * Unknown keys reject rather than being silently dropped.
 */
export async function updateStorySettings(
  storyId: string,
  patch: Partial<StorySettings>,
  ctx: DbCtx,
  nowMs: number = Date.now(),
): Promise<StorySettings> {
  // Explicit `undefined` typechecks without exactOptionalPropertyTypes, and
  // spreading it in would trip zod's defaults instead of leaving the key alone.
  const changed = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  )
  // `Partial<StorySettings>` is a compile-time claim only, and zod strips
  // unknown keys — without this a typo'd key reports a successful save that
  // wrote nothing.
  // `hasOwn`, not `in`: `in` walks the prototype chain, so `constructor` and
  // `toString` would pass the guard and then be stripped by zod.
  const unknownKeys = Object.keys(changed).filter(
    (key) => !Object.hasOwn(storySettingsSchema.shape, key),
  )
  if (unknownKeys.length > 0) {
    throw new Error(`Unknown story-settings key(s): ${unknownKeys.join(', ')}`)
  }
  const validated = storySettingsPartialSchema.parse(changed)

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

  const settings = storySettingsSchema.parse({ ...stored.data, ...validated })

  await ctx.runInTransaction([
    ctx.db
      .update(stories)
      .set({ settings, updatedAt: nowMs })
      .where(eq(stories.id, storyId))
      .toSQL(),
  ])

  // `rehydrateStories` swallows its own failure, so an unchecked call leaves
  // the store showing pre-save values while reporting a clean save.
  if (!(await rehydrateStories(ctx.db))) throw new StorySettingsStaleStoreError()
  const open = currentStoryStore.getCurrentStory()
  if (open?.storyId === storyId) currentStoryStore.set({ ...open, settings })
  return settings
}
