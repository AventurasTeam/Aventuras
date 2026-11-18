import { expect } from '@playwright/test'

import { describeStart, type Start } from '../flows/close-start'
import { goToChapterTimeline } from '../flows/navigation'
import { closeChapter } from '../locators/close-chapter'
import { reader } from '../locators/reader'

// chapter-timeline.md → Chapter-close modal: the three starts that sit on a screen rather than in
// the Actions menu.
const STARTS: readonly Start[] = [
  {
    from: 'the chapter popover',
    open: async (page, pick) => {
      await reader.chapterProgressHit(page).click()
      await expect(closeChapter.popoverAction(page)).toBeEnabled()
      await closeChapter.popoverAction(page).click()
      await expect(closeChapter.modal(page)).toBeVisible()
      await closeChapter.pickReply(page, pick.ref)
    },
  },
  {
    from: 'the in-progress card',
    open: async (page, pick) => {
      await goToChapterTimeline(page)
      await expect(closeChapter.inProgressCardAction(page)).toBeEnabled()
      await closeChapter.inProgressCardAction(page).click()
      await expect(closeChapter.modal(page)).toBeVisible()
      await closeChapter.pickReply(page, pick.ref)
    },
  },
  {
    from: 'Close chapter here',
    open: async (page, pick) => {
      await (await closeChapter.closeHere(page, pick.id)).click()
      await expect(closeChapter.modal(page)).toBeVisible()
      // The entry's button opens the modal with its end already picked.
      await expect(
        closeChapter.pickerTrigger(page).getByText(pick.ref, { exact: true }),
      ).toBeVisible()
    },
  },
]

STARTS.forEach(describeStart)
