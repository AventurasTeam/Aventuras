import { describeStart, pickFromMenu, type Start } from '../flows/close-start'
import { goToChapterTimeline, goToPlot, goToStorySettings, goToWorld } from '../flows/navigation'

// chapter-timeline.md → Chapter-close modal; each start picks STORY TOOLS → Close chapter….
const STARTS: readonly Start[] = [
  {
    from: 'the Actions menu on World',
    open: async (page, pick) => {
      await goToWorld(page)
      await pickFromMenu(page, pick)
    },
  },
  {
    from: 'the Actions menu on Plot',
    open: async (page, pick) => {
      await goToPlot(page)
      await pickFromMenu(page, pick)
    },
  },
  {
    from: 'the Actions menu on Story Settings',
    open: async (page, pick) => {
      await goToStorySettings(page)
      await pickFromMenu(page, pick)
    },
  },
  { from: 'the Actions menu on the reader', open: pickFromMenu },
  {
    from: 'the Actions menu on the Timeline',
    open: async (page, pick) => {
      await goToChapterTimeline(page)
      await pickFromMenu(page, pick)
    },
  },
]

STARTS.forEach(describeStart)
