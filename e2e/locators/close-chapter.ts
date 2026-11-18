import { expect, type Locator, type Page } from '@playwright/test'

import { chapterTimeline } from './chapter-timeline'
import { reader } from './reader'
import { copyPattern, t } from '../harness/i18n'

// The close modal and the four controls that open it (chapter-timeline.md → Chapter-close modal).
// Picker trigger and panel are Tier 3 testIDs: the trigger's name is the row's whole anatomy.

const modal = (page: Page): Locator =>
  page.getByRole('dialog', { name: t('chapters:closeModal.title'), exact: true })

// A modal over the page hides it from the accessibility tree, so absence under one is read with
// hidden nodes.
const mounted = (page: Page): Locator =>
  page.getByRole('dialog', {
    name: t('chapters:closeModal.title'),
    exact: true,
    includeHidden: true,
  })

const pickerTrigger = (page: Page): Locator => modal(page).getByTestId('close-chapter-picker')

const panel = (page: Page): Locator => modal(page).getByTestId('close-chapter-panel')

// Exact: `Close chapter` must not match `Close chapter…` or `Close chapter here`.
const footButton = (page: Page, key: 'confirm' | 'cancel'): Locator =>
  modal(page).getByRole('button', { name: t(`chapters:closeModal.${key}`), exact: true })

export const closeChapter = {
  modal,
  mounted,
  pickerTrigger,

  // Opens the panel, pages it from the top until the row renders in the virtualized window, picks
  // it; the panel collapses. The testID sits on the scrolling element itself (web).
  pickReply: async (page: Page, entryRef: string): Promise<void> => {
    if (!(await panel(page).isVisible())) await pickerTrigger(page).click()
    await expect(panel(page)).toBeVisible()
    const row = panel(page).getByText(entryRef, { exact: true })
    await panel(page).evaluate((scroller) => {
      scroller.scrollTop = 0
    })
    await expect(async () => {
      if ((await row.count()) > 0) return
      // A page per attempt: the rows rendered ahead of the window cover the overlap. Past the
      // bottom, back to the top, so a row above the first window is still reached.
      await panel(page).evaluate((scroller) => {
        const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1
        if (atBottom) scroller.scrollTop = 0
        else scroller.scrollBy(0, scroller.clientHeight)
      })
      throw new Error(`${entryRef} is not among the panel's rendered rows yet`)
    }).toPass({ timeout: 10_000, intervals: [100] })
    await row.click()
    await expect(panel(page)).toBeHidden()
    // Exact: `entry #6` must not match a trigger showing `entry #61`.
    await expect(pickerTrigger(page).getByText(entryRef, { exact: true })).toBeVisible()
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

  /** Waits for the gate to open: a disabled action renames itself to its reason. */
  closeHere: async (page: Page, entryId: string): Promise<Locator> => {
    const action = reader
      .row(page, entryId)
      .getByRole('button', { name: t('reader:entryCard.closeChapterHere'), exact: true })
    await expect(action).toBeVisible({ timeout: 30_000 })
    return action
  },
}
