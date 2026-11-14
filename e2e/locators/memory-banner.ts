import type { Locator, Page } from '@playwright/test'

import { t } from '../harness/i18n'

// components/compounds/memory-run-banner.tsx: Cancel shares `common:cancel` with the composer's, so
// scope queries to it. A stack keeps lower screens' banners mounted; only the visible one counts.
const banner = (page: Page): Locator =>
  page.getByTestId('memory-run-banner').filter({ visible: true })

export const memoryBanner = {
  banner,
  updating: (page: Page): Locator =>
    banner(page).getByText(t('chrome.memoryBanner.updating'), { exact: true }),
  updatingBeforeTurn: (page: Page): Locator =>
    banner(page).getByText(t('chrome.memoryBanner.updatingBeforeTurn'), { exact: true }),
  closingMetadata: (page: Page): Locator =>
    banner(page).getByText(t('chrome.memoryBanner.closingMetadata'), { exact: true }),
  // A close Send runs, at its metadata step: before a turn each step's label says so.
  beforeTurnMetadata: (page: Page): Locator =>
    banner(page).getByText(t('chrome.memoryBanner.beforeTurnMetadata'), { exact: true }),
  cancel: (page: Page): Locator =>
    banner(page).getByRole('button', { name: t('cancel'), exact: true }),
  // A committed close's done state, in the same bar: its label, Review and the icon-only dismiss.
  closed: (page: Page, title: string): Locator =>
    banner(page).getByText(t('chrome.closeResult.closed', { title }), { exact: true }),
  review: (page: Page): Locator =>
    banner(page).getByRole('button', { name: t('chrome.closeResult.review'), exact: true }),
  dismiss: (page: Page): Locator =>
    banner(page).getByRole('button', { name: t('chrome.closeResult.dismiss'), exact: true }),
}
