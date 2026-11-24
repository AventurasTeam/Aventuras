import type { Locator, Page } from '@playwright/test'

import { copyPattern, t } from '../harness/i18n'

// Resolved through the app's own keys (docs/testing.md → Selector strategy, Tier 2). Branch names
// are DB content, so a spec passes the stored name.
const CHIP_ANY = copyPattern('reader:branches.chipLabel', { texts: ['name', 'count'] })
const TITLE_ANY = copyPattern('reader:branches.title', { texts: ['count'] })
const RENAME_ANY = copyPattern('reader:branches.rename', { texts: ['name'] })
const DELETE_ANY = copyPattern('reader:branches.delete', { texts: ['name'] })

export const branchNavigator = {
  // Named `On <name> · <N> branches`; its visible text is the icon and the count.
  chip: (page: Page, name: string, count: number): Locator =>
    page.getByRole('button', {
      name: t('reader:branches.chipLabel', { name, count }),
      exact: true,
    }),
  // For its absence: the single-branch anchor in the chip's slot has no role and no name.
  anyChip: (page: Page): Locator => page.getByRole('button', { name: CHIP_ANY }),
  // The desktop Popover is a dialog; its header tells it from any other.
  navigator: (page: Page): Locator =>
    page.getByRole('dialog').filter({ has: page.getByText(TITLE_ANY) }),
  title: (page: Page, count: number): Locator =>
    branchNavigator
      .navigator(page)
      .getByText(t('reader:branches.title', { count }), { exact: true }),
  // A row's body takes the press anywhere outside its icons, its name included.
  row: (page: Page, name: string): Locator =>
    branchNavigator.navigator(page).getByText(name, { exact: true }),
  renameButton: (page: Page, name: string): Locator =>
    branchNavigator
      .navigator(page)
      .getByRole('button', { name: t('reader:branches.rename', { name }), exact: true }),
  anyRenameButton: (page: Page): Locator =>
    branchNavigator.navigator(page).getByRole('button', { name: RENAME_ANY }),
  anyDeleteButton: (page: Page): Locator =>
    branchNavigator.navigator(page).getByRole('button', { name: DELETE_ANY }),
  renameInput: (page: Page): Locator =>
    page.getByRole('textbox', { name: t('reader:branches.renameInput'), exact: true }),
  pausedBanner: (page: Page): Locator =>
    page.getByText(t('reader:branches.paused'), { exact: true }),
  // Actions menu rows are listbox options (searchable-overlay-list.tsx) named by their label.
  browseBranchesRow: (page: Page): Locator =>
    page.getByRole('option', { name: t('reader:actions.browseBranches'), exact: true }),
}
