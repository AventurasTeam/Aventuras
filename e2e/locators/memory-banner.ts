import type { Locator, Page } from '@playwright/test'

import { t } from '../harness/i18n'

// The memory-run banner below every in-story top bar (components/compounds/memory-run-banner.tsx,
// testID `memory-run-banner`), rendered only while a pass runs. Its Cancel shares `common:cancel`
// with the composer's, so every query is scoped to the banner. A stack keeps the screens under the
// top one mounted, each with its banner, so only the visible one counts.
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
