import {
  storySettingsSchema,
  type Story,
  type StoryDefinition,
  type StoryInfo,
  type StorySettings,
} from '@/lib/db'

/**
 * What a tab panel is given to render. `stories.settings` is nullable and the
 * wizard inserts a draft row before settings exist, so "the story is there but
 * has no settings" is a real persisted state — distinct from a cold read that
 * hasn't landed yet and from a story that isn't there at all.
 */
export type StorySettingsPanelData =
  | { status: 'loading' }
  /** The story rows could not be read. Not the same as a story that is gone. */
  | { status: 'unavailable' }
  | { status: 'missing' }
  | { status: 'uninitialized' }
  /**
   * Settings are stored, but fail the schema. `stories.settings` is a `$type`
   * cast over a JSON column, so this arrives typed as valid: panels that derived
   * a draft from it would build patches the save can only refuse.
   */
  | { status: 'corrupt' }
  /**
   * `definition` is a separate nullable column, not part of `settings`, and
   * nothing on the write path guarantees a settings-bearing row has one — so
   * panels keying off `definition.mode` must handle its absence.
   */
  | {
      status: 'ready'
      settings: StorySettings
      definition: StoryDefinition | null
      /** The library-shaped columns the About tab edits. */
      story: StoryInfo
    }

/** Whether the story-rows read has landed; a failed read is not an absent story. */
export type StoryRowsHydration = 'pending' | 'ok' | 'failed'

/**
 * Resolves the row into what a panel may render. The settings parse lives here
 * rather than at the panels: `stories.settings` is a `$type` cast, so only a
 * successful parse earns the `ready` arm.
 */
export function storySettingsPanelData(
  storyId: string | undefined,
  hydration: StoryRowsHydration,
  row: Story | undefined,
): StorySettingsPanelData {
  if (storyId == null) return { status: 'missing' }
  if (hydration === 'pending') return { status: 'loading' }
  if (hydration === 'failed') return { status: 'unavailable' }
  if (row == null) return { status: 'missing' }
  if (row.settings == null) return { status: 'uninitialized' }

  const stored = storySettingsSchema.safeParse(row.settings)
  if (!stored.success) return { status: 'corrupt' }

  return {
    status: 'ready',
    settings: stored.data,
    definition: row.definition ?? null,
    story: {
      title: row.title,
      description: row.description,
      tags: row.tags,
      accentColor: row.accentColor,
      status: row.status,
      favorite: row.favorite,
    },
  }
}
