/**
 * Adding an id to a group here registers the tab: the id union, the
 * deep-link accept-list, each section's save-bar order, and the
 * `storySettings:tabs.<id>` label lookup all derive from this structure, so a
 * rail entry can't drift out of sync with them. A missing locale key is a
 * typecheck failure, not a runtime one.
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

// A duplicate id keeps the union intact but silently mounts two panels and
// makes `indexOf` resolve both to the first one's rail slot. Node (vitest)
// leaves __DEV__ undefined, so the check runs there too.
if (typeof __DEV__ === 'undefined' || __DEV__) {
  const unique = new Set(STORY_SETTINGS_TAB_IDS)
  if (unique.size !== STORY_SETTINGS_TAB_IDS.length) {
    throw new Error('STORY_SETTINGS_TAB_GROUPS contains a duplicate tab id.')
  }
}

/** Rail position of a tab. `computeSnapshot` resolves it to order the save bar. */
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
