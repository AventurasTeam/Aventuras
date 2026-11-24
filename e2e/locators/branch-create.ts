import type { Locator, Page } from '@playwright/test'

import { t } from '../harness/i18n'

// components/reader/branch-create-modal.tsx: a Dialog named by its title. Its Cancel shares the
// word with the composer's, so every control is scoped to it (docs/testing.md → Selector strategy).
export function branchCreate(page: Page): {
  root: Locator
  name: Locator
  create: Locator
  cancel: Locator
} {
  const root = page.getByRole('dialog', { name: t('reader:branches.create.title'), exact: true })
  return {
    root,
    // Not exact: the label may carry the required marker.
    name: root.getByRole('textbox', { name: t('reader:branches.create.name') }),
    create: root.getByRole('button', { name: t('reader:branches.create.confirm'), exact: true }),
    cancel: root.getByRole('button', { name: t('reader:branches.create.cancel'), exact: true }),
  }
}
