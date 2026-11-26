import type { Locator, Page } from '@playwright/test'

import { escapeRegExp, t } from '../harness/i18n'

const TITLE = t('landing:duplicate.title')
const BRANCH = t('landing:duplicate.branch')

// The story list's Duplicate dialog (components/story/duplicate-story-dialog.tsx), told from the
// card's overflow Popover, a dialog too, by its title.
const dialog = (page: Page): Locator =>
  page.getByRole('dialog').filter({ has: page.getByText(TITLE, { exact: true }) })

export const duplicateStory = {
  dialog,
  // The dialog's one text field.
  nameInput: (page: Page): Locator => dialog(page).getByRole('textbox'),
  // rn-primitives' web trigger may surface as either role; the Select's label names it in both.
  branchSelect: (page: Page): Locator =>
    dialog(page)
      .getByRole('button', { name: BRANCH, exact: true })
      .or(dialog(page).getByRole('combobox', { name: BRANCH, exact: true })),
  // The open listbox portals out of the dialog. The current branch's option is labelled
  // `<name> · <currentMark>` in one string, so a row matches its bare name or that label.
  branchOption: (page: Page, name: string): Locator =>
    page.getByRole('option').filter({
      hasText: new RegExp(
        `^${escapeRegExp(name)}( · ${escapeRegExp(t('landing:duplicate.currentMark'))})?$`,
      ),
    }),
  allBranches: (page: Page, count: number): Locator =>
    page.getByRole('option').filter({
      has: page.getByText(t('landing:duplicate.allBranches', { count }), { exact: true }),
    }),
  refusal: (page: Page, key: 'swapPending' | 'unrecovered' | 'running'): Locator =>
    dialog(page).getByText(t(`landing:duplicate.refused.${key}`), { exact: true }),
  confirm: (page: Page): Locator =>
    dialog(page).getByRole('button', { name: t('landing:duplicate.confirm'), exact: true }),
}
