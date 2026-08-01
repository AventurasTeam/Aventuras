import type { StoryDefinition, StorySettings } from '@/lib/db'

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
   * `definition` is a separate nullable column, not part of `settings`, and
   * nothing on the write path guarantees a settings-bearing row has one — so
   * panels keying off `definition.mode` must handle its absence.
   */
  | { status: 'ready'; settings: StorySettings; definition: StoryDefinition | null }
