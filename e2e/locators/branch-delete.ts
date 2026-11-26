import type { Locator, Page } from '@playwright/test'

import { t } from '../harness/i18n'

const CONFIRM = t('reader:branches.deleteConfirm.confirm')

// The branch delete confirm (components/reader/branch-delete-confirm.tsx). No other alertdialog
// on the reader carries `Delete branch`, so its button tells this one apart.
function root(page: Page): Locator {
  return page
    .getByRole('alertdialog')
    .filter({ has: page.getByRole('button', { name: CONFIRM, exact: true }) })
}

export const branchDelete = {
  dialog: (page: Page, name: string): Locator =>
    root(page).filter({
      has: page.getByText(t('reader:branches.deleteConfirm.title', { name }), { exact: true }),
    }),
  // Zero has a line of its own; any other count takes the plural the app picks.
  countLine: (page: Page, count: number): Locator =>
    root(page).getByText(
      count === 0
        ? t('reader:branches.deleteConfirm.countNone')
        : t('reader:branches.deleteConfirm.count', { count }),
      { exact: true },
    ),
  confirm: (page: Page): Locator => root(page).getByRole('button', { name: CONFIRM, exact: true }),
  // `common:cancel`, which every other Cancel on the screen shares.
  cancel: (page: Page): Locator =>
    root(page).getByRole('button', { name: t('cancel'), exact: true }),
}
