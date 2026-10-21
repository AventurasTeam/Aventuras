import type { Locator, Page } from '@playwright/test'

import { t } from '../harness/i18n'

// The story-leave abort-confirm (components/compounds/story-leave-dialog.tsx). "Cancel & leave"
// holds "Cancel", so both buttons are scoped to the dialog and matched exactly.
export const storyLeave = {
  dialog: (page: Page): Locator =>
    page.getByRole('alertdialog').filter({ hasText: t('storyLeave.title') }),
  stay: (page: Page): Locator =>
    storyLeave.dialog(page).getByRole('button', { name: t('storyLeave.stay'), exact: true }),
  cancelAndLeave: (page: Page): Locator =>
    storyLeave
      .dialog(page)
      .getByRole('button', { name: t('storyLeave.cancelAndLeave'), exact: true }),
}
