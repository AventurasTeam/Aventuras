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

/** The surface's route, or null while it has no route yet. */
export function inStoryRoute(
  surface: InStorySurface,
  story: Pick<InStoryContext, 'storyId' | 'branchId'>,
): string | null {
  switch (surface) {
    case 'reader':
      return `/reader-composer/${story.branchId}`
    case 'world':
      return `/world/${story.branchId}`
    case 'story-settings':
      return `/story-settings/${story.storyId}`
    case 'plot':
    case 'chapter-timeline':
      return null
  }
}

const ENTRY: Record<
  InStorySurface,
  { id: string; label: () => string; landsLater?: () => string }
> = {
  reader: { id: 'open-reader', label: () => t('chrome.goTo.openReader') },
  world: { id: 'open-world', label: () => t('chrome.goTo.openWorld') },
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
  'story-settings': { id: 'open-story-settings', label: () => t('chrome.goTo.openStorySettings') },
}

// actions-menu.md → Curated core: self-omits current surface, unbuilt disables (not hides).
export function buildGoToGroup(
  story: InStoryContext,
  navigate: (path: string) => void,
): ActionGroup {
  const entries = IN_STORY_SURFACES.filter((surface) => surface !== story.surface).map(
    (surface) => {
      const spec = ENTRY[surface]
      const route = inStoryRoute(surface, story)
      if (route == null) {
        return {
          id: spec.id,
          label: spec.label(),
          disabled: true,
          disabledReason: spec.landsLater?.(),
          onActivate: () => {},
        }
      }
      return { id: spec.id, label: spec.label(), onActivate: () => navigate(route) }
    },
  )
  return { id: 'go-to', header: t('chrome.goTo.header'), entries }
}
