import type { Locator, Page } from '@playwright/test'

import { chapterTimeline } from './chapter-timeline'
import { t } from '../harness/i18n'

const CONFIRM = t('chapters:deleteConfirm.confirm')

// The Timeline's leave dialog is an alertdialog too: the confirm's own button tells them apart.
function dialog(page: Page): Locator {
  return page
    .getByRole('alertdialog')
    .filter({ has: page.getByRole('button', { name: CONFIRM, exact: true }) })
}

// The Chapter Timeline's delete confirm (components/chapters/chapter-delete-confirm.tsx).
export const chapterDelete = {
  // Only an expanded card renders its action row: a spec expands the card first.
  action: (page: Page, chapterId: string): Locator =>
    chapterTimeline
      .card(page, chapterId)
      .getByRole('button', { name: t('chapters:actions.delete'), exact: true }),
  dialog,
  removeDivider: (page: Page): Locator =>
    dialog(page).getByRole('button', {
      name: t('chapters:deleteConfirm.removeDivider'),
      exact: true,
    }),
  confirm: (page: Page): Locator =>
    dialog(page).getByRole('button', { name: CONFIRM, exact: true }),
  // AlertDialogCancel uses the shared `common:cancel`.
  cancel: (page: Page): Locator =>
    dialog(page).getByRole('button', { name: t('cancel'), exact: true }),
}
