import type { Locator, Page } from '@playwright/test'

import { copyPattern, t } from '../harness/i18n'

// components/chapters/close-rerun-confirm.tsx: an AlertDialog, told from the Timeline's leave
// dialog by its title, which interpolates the chapter number.
const TITLE = copyPattern('chapters:rerunConfirm.title', { texts: ['number'] })

const button = (root: Locator, key: string): Locator =>
  root.getByRole('button', { name: t(key), exact: true })

export function rerunConfirm(page: Page): {
  root: Locator
  cancel: Locator
  rerun: Locator
  rollbackAndRerun: Locator
  rerunOnBranch: Locator
} {
  const root = page.getByRole('alertdialog').filter({ has: page.getByText(TITLE) })
  return {
    root,
    cancel: button(root, 'chapters:rerunConfirm.cancel'),
    rerun: button(root, 'chapters:rerunConfirm.rerun'),
    rollbackAndRerun: button(root, 'chapters:rerunConfirm.rollbackAndRerun'),
    rerunOnBranch: button(root, 'chapters:rerunConfirm.rerunOnBranch'),
  }
}
