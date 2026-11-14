import type { Locator, Page } from '@playwright/test'

import { copyPattern, t } from '../harness/i18n'

// components/chapters/review-window.tsx above phone: a Dialog named by its DialogTitle, which
// interpolates the chapter, so the pattern matches any review and specs assert the exact title.
const TITLE = copyPattern('chapters:review.title', { texts: ['number', 'title'] })

const dialog = (page: Page): Locator => page.getByRole('dialog', { name: TITLE })

export const reviewWindow = {
  window: dialog,
  // A review row passes DeltaLogRow no entry, so its name is `<op> <target>` (history:rowLabel);
  // the entry rides in the footer's link.
  row: (page: Page, name: string): Locator =>
    dialog(page).getByRole('button', { name, exact: true }),
  // `entry` is the formatted ref (`entry #n`) the link's label wraps.
  entryLink: (page: Page, entry: string): Locator =>
    dialog(page).getByRole('link', {
      name: t('chapters:review.entryLink', { entry }),
      exact: true,
    }),
  // The collapsed Accordion's trigger.
  notApplied: (page: Page, count: number): Locator =>
    dialog(page).getByRole('button', {
      name: t('chapters:review.notApplied', { count }),
      exact: true,
    }),
  done: (page: Page): Locator =>
    dialog(page).getByRole('button', { name: t('chapters:review.done'), exact: true }),
}
