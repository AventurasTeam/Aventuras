import type { Locator, Page } from '@playwright/test'

import { t } from '../harness/i18n'

// Home-screen locators resolved through the app's own i18n keys, so copy
// changes and locale growth propagate here for free and a renamed key fails
// loudly (docs/testing.md → Selector strategy, Tier 2).
export const home = {
  // The per-story open control. Its accessible name is unique per row
  // (t('storyCard.open', { title })), so it doubles as a row selector.
  openStory: (page: Page, title: string): Locator =>
    page.getByRole('button', { name: t('storyCard.open', { title }) }),

  // The list header count: t('landing:list.total', { count }).
  listTotal: (page: Page, count: number): Locator =>
    page.getByText(t('landing:list.total', { count }), { exact: false }),

  // Starts the wizard (goes straight to /wizard when no live session exists).
  newStory: (page: Page): Locator => page.getByRole('button', { name: t('landing:list.newStory') }),

  // The per-card overflow trigger: its own label repeats on every card, so it is reached
  // through the open button — the only per-card unique name — and a hop to their shared parent.
  storyActions: (page: Page, title: string): Locator =>
    page
      .getByRole('button', { name: t('storyCard.open', { title }) })
      .locator('..')
      .getByRole('button', { name: t('storyCard.actionsLabel') }),

  // The card's overflow entries are menu items, not plain text: the press
  // handler is on the row and its accessible name is the label.
  editInfo: (page: Page): Locator => page.getByRole('menuitem', { name: t('storyCard.editInfo') }),
}
