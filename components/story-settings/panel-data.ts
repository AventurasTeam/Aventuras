import type { StorySettings } from '@/lib/db'

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
  | { status: 'ready'; settings: StorySettings }
