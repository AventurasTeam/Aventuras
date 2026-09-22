import type { Locator, Page } from '@playwright/test'

import { t } from '../harness/i18n'

// The shared row-save-session chrome (components/compounds/{save-bar,unsaved-changes-dialog}.tsx),
// hosted by both Story Settings (components/story-settings/save-session-chrome.tsx) and Plot
// (components/compounds/row-save-session-chrome.tsx). Every surface that mounts a save session
// resolves through the same i18n keys, so this is the one query set both specs share — see
// docs/testing.md → Selector strategy (Tier 2).
export const saveSession = {
  // The save button's accessible name carries a platform shortcut hint
  // (`Save Ctrl+S`), so it anchors rather than matching exactly.
  saveBarSave: (page: Page): Locator =>
    page.getByRole('button', { name: new RegExp(`^${t('saveBar.save')}`) }),

  saveBarDiscard: (page: Page): Locator => page.getByRole('button', { name: t('saveBar.discard') }),

  // getByText alone is ambiguous here: the dialog body's copy also contains
  // the substring "unsaved changes" (getByText is a case-insensitive
  // substring match), so it resolves both the title and the description.
  // Anchoring on the alertdialog role stays unambiguous even with other
  // AlertDialogs in the tree.
  unsavedDialog: (page: Page): Locator =>
    page.getByRole('alertdialog').filter({ hasText: t('unsavedChanges.title') }),

  // Scoped inside the dialog, not a bare role+name query: the save bar behind
  // it stays in the accessibility tree while the dialog is open, so an
  // unscoped query would resolve both this button and the save bar's own.
  unsavedDiscard: (page: Page): Locator =>
    saveSession.unsavedDialog(page).getByRole('button', { name: t('unsavedChanges.discard') }),

  unsavedSave: (page: Page): Locator =>
    saveSession.unsavedDialog(page).getByRole('button', { name: t('unsavedChanges.save') }),

  // The dialog's AlertDialogCancel uses the shared `common:cancel`, not a
  // surface-namespaced key.
  unsavedCancel: (page: Page): Locator =>
    saveSession.unsavedDialog(page).getByRole('button', { name: t('cancel') }),
}
