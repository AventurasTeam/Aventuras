/**
 * C7 seam: adding a tab id to a group here registers the tab. The id union,
 * the deep-link accept-list, and each section's save-bar `order` all derive
 * from this one structure, so a rail entry can't drift out of sync with them.
 * Labels resolve at render (`storySettings:tabs.<id>`) so a language switch
 * still reaches them; the section body itself lives in its own module and
 * joins the save session via `useStorySettingsSection`.
 */
const STORY_SETTINGS_TAB_GROUPS = [
  { id: 'story', tabs: ['about', 'generation'] },
  { id: 'settings', tabs: ['models', 'memory', 'translation', 'pack', 'calendar', 'advanced'] },
] as const

type StorySettingsGroupId = (typeof STORY_SETTINGS_TAB_GROUPS)[number]['id']
type StorySettingsTabId = (typeof STORY_SETTINGS_TAB_GROUPS)[number]['tabs'][number]

const STORY_SETTINGS_TAB_IDS: readonly StorySettingsTabId[] = STORY_SETTINGS_TAB_GROUPS.flatMap(
  (group) => group.tabs,
)

/** Rail position of the owning tab — what `useStorySettingsSection` wants for `order`. */
function storySettingsTabOrder(id: StorySettingsTabId): number {
  return STORY_SETTINGS_TAB_IDS.indexOf(id)
}

function isStorySettingsTabId(value: string | undefined): value is StorySettingsTabId {
  return STORY_SETTINGS_TAB_IDS.includes(value as StorySettingsTabId)
}

export {
  isStorySettingsTabId,
  STORY_SETTINGS_TAB_GROUPS,
  STORY_SETTINGS_TAB_IDS,
  storySettingsTabOrder,
}
export type { StorySettingsGroupId, StorySettingsTabId }
