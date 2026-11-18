import { expect, type Locator, type Page } from '@playwright/test'

import { chapterTimeline } from './chapter-timeline'
import { reader } from './reader'
import { copyPattern, t } from '../harness/i18n'

// The close modal (components/chapters/close-chapter-modal-view.tsx) and the four controls that
// open it (chapter-timeline.md → Chapter-close modal). The picker trigger and its panel are Tier 3
// testIDs: the trigger's name is the picked row's whole anatomy, and the panel's rows virtualize.

const modal = (page: Page): Locator =>
  page.getByRole('dialog', { name: t('chapters:closeModal.title'), exact: true })

const pickerTrigger = (page: Page): Locator => modal(page).getByTestId('close-chapter-picker')

const panel = (page: Page): Locator => modal(page).getByTestId('close-chapter-panel')

// Exact: `Close chapter` must not match `Close chapter…` or `Close chapter here`.
const footButton = (page: Page, key: 'confirm' | 'cancel'): Locator =>
  modal(page).getByRole('button', { name: t(`chapters:closeModal.${key}`), exact: true })

export const closeChapter = {
  modal,
  pickerTrigger,

  // Opens the panel, scrolls the row into the virtualized window, picks it; the panel collapses.
  pickReply: async (page: Page, entryRef: string): Promise<void> => {
    if (!(await panel(page).isVisible())) await pickerTrigger(page).click()
    await expect(panel(page)).toBeVisible()
    const row = panel(page).getByText(entryRef, { exact: true })
    await expect(async () => {
      if ((await row.count()) > 0) return
      // The testID may sit on the scroller or on a wrapper around it.
      await panel(page).evaluate((root) => {
        const scroller = [root, ...Array.from(root.querySelectorAll('*'))].find(
          (node) => node.scrollHeight > node.clientHeight,
        )
        if (scroller !== undefined) scroller.scrollBy(0, Math.max(scroller.clientHeight / 2, 40))
      })
      throw new Error(`${entryRef} is not among the panel's rendered rows yet`)
    }).toPass({ timeout: 10_000 })
    await row.click()
    await expect(panel(page)).toBeHidden()
    await expect(pickerTrigger(page)).toContainText(entryRef)
  },

  // Built per call: a module-level pattern would throw at import for every spec if the copy moved.
  tokensInRange: (page: Page): Locator =>
    modal(page).getByText(copyPattern('chapters:closeModal.tokensInRange', { numbers: ['count'] })),

  // The modal closes at once on confirm: the close runs under the banner.
  confirm: async (page: Page): Promise<void> => {
    await expect(footButton(page, 'confirm')).toBeEnabled()
    await footButton(page, 'confirm').click()
    await expect(modal(page)).toHaveCount(0)
  },

  cancel: async (page: Page): Promise<void> => {
    await footButton(page, 'cancel').click()
    await expect(modal(page)).toHaveCount(0)
  },

  // STORY TOOLS rows are listbox options, as GO TO's are (searchable-overlay-list.tsx).
  storyToolsEntry: (page: Page): Locator =>
    page.getByRole('option', { name: t('chrome.storyTools.closeChapter'), exact: true }),

  popoverAction: (page: Page): Locator =>
    page.getByRole('button', { name: t('chapters:popover.closeManually'), exact: true }),

  // Scoped to the card: the open Actions menu's `Close chapter…` shares the label.
  inProgressCardAction: (page: Page): Locator =>
    chapterTimeline
      .inProgressCard(page)
      .getByRole('button', { name: t('chapters:inProgress.close'), exact: true }),

  closeHere: async (page: Page, entryId: string): Promise<Locator> => {
    const action = reader
      .row(page, entryId)
      .getByRole('button', { name: t('reader:entryCard.closeChapterHere'), exact: true })
    await expect(action).toBeVisible({ timeout: 30_000 })
    return action
  },
}
