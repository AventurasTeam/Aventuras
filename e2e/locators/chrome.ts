import type { Locator, Page } from '@playwright/test'

import { t } from '../harness/i18n'

// ScreenShell's chrome (components/shells/screen-shell.tsx) and the app Actions menu it opens:
// the same controls on every in-story screen, so no surface file owns them.
export const chrome = {
  back: (page: Page): Locator => page.getByRole('button', { name: t('chrome.back') }),

  // On web the trigger's accessible name carries the "(Ctrl+K)" hint, so it anchors on the base label.
  actionsTrigger: (page: Page): Locator =>
    page.getByRole('button', { name: new RegExp(t('chrome.actions')) }),

  // GO TO rows are listbox options (searchable-overlay-list.tsx) named by their label.
  goToReaderRow: (page: Page): Locator =>
    page.getByRole('option', { name: t('chrome.goTo.openReader'), exact: true }),
  goToWorldRow: (page: Page): Locator =>
    page.getByRole('option', { name: t('chrome.goTo.openWorld'), exact: true }),
  goToPlotRow: (page: Page): Locator =>
    page.getByRole('option', { name: t('chrome.goTo.openPlot'), exact: true }),
  goToStorySettingsRow: (page: Page): Locator =>
    page.getByRole('option', { name: t('chrome.goTo.openStorySettings'), exact: true }),
}
