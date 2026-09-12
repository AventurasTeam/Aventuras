import type { ActionGroup } from '@/components/compounds/actions-menu'
import { t } from '@/lib/i18n'

export const IN_STORY_SURFACES = [
  'reader',
  'world',
  'plot',
  'chapter-timeline',
  'story-settings',
] as const
export type InStorySurface = (typeof IN_STORY_SURFACES)[number]

/** What an in-story screen hands the Actions menu so the GO TO group can render. */
export type InStoryContext = { storyId: string; branchId: string; surface: InStorySurface }

type StoryIds = Pick<InStoryContext, 'storyId' | 'branchId'>

type SurfaceEntry = { id: string; label: () => string } & (
  | { route: (story: StoryIds) => string }
  | { landsLater: () => string }
)

const ENTRY: Record<InStorySurface, SurfaceEntry> = {
  reader: {
    id: 'open-reader',
    label: () => t('chrome.goTo.openReader'),
    route: (story) => `/reader-composer/${story.branchId}`,
  },
  world: {
    id: 'open-world',
    label: () => t('chrome.goTo.openWorld'),
    route: (story) => `/world/${story.branchId}`,
  },
  plot: {
    id: 'open-plot',
    label: () => t('chrome.goTo.openPlot'),
    landsLater: () => t('chrome.goTo.plotLandsLater'),
  },
  'chapter-timeline': {
    id: 'open-chapter-timeline',
    label: () => t('chrome.goTo.openChapterTimeline'),
    landsLater: () => t('chrome.goTo.chapterTimelineLandsLater'),
  },
  'story-settings': {
    id: 'open-story-settings',
    label: () => t('chrome.goTo.openStorySettings'),
    route: (story) => `/story-settings/${story.storyId}`,
  },
}

/** The surface's route, or null while it has no route yet. */
export function inStoryRoute(surface: InStorySurface, story: StoryIds): string | null {
  const entry = ENTRY[surface]
  return 'route' in entry ? entry.route(story) : null
}

// actions-menu.md → Curated core: self-omits current surface, unbuilt disables (not hides).
export function buildGoToGroup(
  story: InStoryContext,
  navigate: (path: string) => void,
): ActionGroup {
  const entries = IN_STORY_SURFACES.filter((surface) => surface !== story.surface).map(
    (surface) => {
      const entry = ENTRY[surface]
      if ('route' in entry) {
        const route = entry.route(story)
        return { id: entry.id, label: entry.label(), onActivate: () => navigate(route) }
      }
      return {
        id: entry.id,
        label: entry.label(),
        disabled: true,
        disabledReason: entry.landsLater(),
        onActivate: () => {},
      }
    },
  )
  return { id: 'go-to', header: t('chrome.goTo.header'), entries }
}
