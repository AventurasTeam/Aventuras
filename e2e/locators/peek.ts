import type { Locator, Page } from '@playwright/test'

import { t } from '../harness/i18n'

// The reader's peek drawer (components/reader/peek/), a dialog named for its row. Every control is
// scoped inside it: the rail under it lists the same names. testing.md → Selector strategy.
export const peek = {
  drawer: (page: Page, name: string): Locator =>
    page.getByRole('dialog', { name: t('reader:peek.label', { name }), exact: true }),
  close: (page: Page, name: string): Locator =>
    peek.drawer(page, name).getByRole('button', { name: t('reader:peek.close'), exact: true }),

  // Exact, so it misses the action disabled with a reason, whose name appends the reason
  // (common:disabledWithReason); RN-Web keeps the role and sets aria-disabled.
  setLead: (page: Page, name: string): Locator =>
    peek.drawer(page, name).getByRole('button', { name: t('reader:peek.setLead'), exact: true }),
  setLeadDisabled: (page: Page, name: string, reason: string): Locator =>
    peek.drawer(page, name).getByRole('button', {
      name: t('common:disabledWithReason', { label: t('reader:peek.setLead'), reason }),
      exact: true,
    }),
  // The head's LeadTag; the hero story runs in adventure mode, so the lead reads `You`.
  leadTag: (page: Page, name: string): Locator =>
    peek.drawer(page, name).getByText(t('world:lead.you'), { exact: true }),

  openInWorld: (page: Page, name: string): Locator =>
    peek.drawer(page, name).getByRole('link', { name: t('reader:peek.openInWorld'), exact: true }),
  openInPlot: (page: Page, name: string): Locator =>
    peek.drawer(page, name).getByRole('link', { name: t('reader:peek.openInPlot'), exact: true }),

  // A testID inside the drawer: an Overview region is named by its own content, and a peek body
  // or its counts line has no role at all (Tier 3).
  region: (page: Page, name: string, testID: string): Locator =>
    peek.drawer(page, name).getByTestId(testID),
}
