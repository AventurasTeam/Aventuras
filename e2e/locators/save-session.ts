import type { Locator, Page } from '@playwright/test'

import { t } from '../harness/i18n'

// Shared row-save-session chrome (save-bar / unsaved-changes-dialog), mounted by both Story
// Settings and Plot — the one query set both specs share (testing.md → Selector strategy, Tier 2).
export const saveSession = {
  // The bar's buttons share their names with the unsaved-changes dialog's, and the open dialog
  // hides the bar from the a11y tree: scoped here, a query made then fails rather than pressing
  // the dialog's button.
  saveBar: (page: Page): Locator => page.getByTestId('save-bar'),

  // The save button's accessible name carries a platform shortcut hint
  // (`Save Ctrl+S`), so it anchors rather than matching exactly.
  saveBarSave: (page: Page): Locator =>
    saveSession.saveBar(page).getByRole('button', { name: new RegExp(`^${t('saveBar.save')}`) }),

  saveBarDiscard: (page: Page): Locator =>
    saveSession.saveBar(page).getByRole('button', { name: t('saveBar.discard') }),

  // getByText is ambiguous here: the dialog body's copy also contains "unsaved changes" (case-
  // insensitive substring), matching both title and description — anchor on the alertdialog role.
  unsavedDialog: (page: Page): Locator =>
    page.getByRole('alertdialog').filter({ hasText: t('unsavedChanges.title') }),

  // Scoped inside the dialog, which owns the only Discard in the a11y tree while it is open.
  unsavedDiscard: (page: Page): Locator =>
    saveSession.unsavedDialog(page).getByRole('button', { name: t('unsavedChanges.discard') }),

  unsavedSave: (page: Page): Locator =>
    saveSession.unsavedDialog(page).getByRole('button', { name: t('unsavedChanges.save') }),

  // The dialog's AlertDialogCancel uses the shared `common:cancel`, not a
  // surface-namespaced key.
  unsavedCancel: (page: Page): Locator =>
    saveSession.unsavedDialog(page).getByRole('button', { name: t('cancel') }),
}
