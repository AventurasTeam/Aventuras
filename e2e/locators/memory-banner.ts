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
  cancel: (page: Page): Locator =>
    banner(page).getByRole('button', { name: t('cancel'), exact: true }),
}
