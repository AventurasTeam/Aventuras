import type { Locator, Page } from '@playwright/test'

import { t } from '../harness/i18n'

// The generation status pill every in-story top bar carries
// (components/compounds/generation-status-pill.tsx), in its error states.
export const statusPill = {
  // A warning-tone Tag; interactive, so role=button. The accessible name
  // interpolates the pending-row count, so only the lead-in shared by both
  // plural forms is matched.
  memoryIncomplete: (page: Page): Locator => {
    const copy = t('chrome.generationStatusPill.error.memoryIncomplete', { count: 1 })
    const [prefix, ...rest] = copy.split(' — ')
    // Without the separator the "lead-in" is the whole count-bearing string,
    // which silently stops matching. Fail loudly on the copy change instead.
    if (rest.length === 0) {
      throw new Error(
        `statusPill.memoryIncomplete: no " — " separator in "${copy}"; the count-free lead-in can no longer be isolated`,
      )
    }
    return page.getByRole('button', { name: prefix, exact: false })
  },

  // No count to interpolate, so the copy matches whole.
  swapPaused: (page: Page): Locator =>
    page.getByRole('button', { name: t('chrome.generationStatusPill.error.swapPaused') }),
}
