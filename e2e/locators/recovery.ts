import type { Locator, Page } from '@playwright/test'

import { t } from '../harness/i18n'

// The pre-Router boot surface (components/shells/settings-recovery-screen.tsx): unique title
// text and named buttons need no testID. No locator for `Open file` — never click it, it opens
// a real file manager on the virtual display.
export const recovery = {
  title: (page: Page): Locator => page.getByText(t('recovery.title'), { exact: true }),
  resetSettings: (page: Page): Locator =>
    page.getByRole('button', { name: t('recovery.resetSettings') }),
}

// Landing-screen dialog (components/story/story-config-recovery-dialog.tsx), raised when one
// story's settings fail their schema. Not `recovery` above, which is the pre-Router boot screen.
export const storyRecovery = {
  resetStorySettings: (page: Page): Locator =>
    page.getByRole('button', { name: t('landing:storyRecovery.resetStorySettings') }),
  // Reset swaps in a confirmation rather than acting; `exact: true` is load-bearing because this
  // label prefixes the button above's, so between that click returning and the swap committing a
  // substring query re-resolves Reset — re-opening the confirmation instead of committing it.
  confirmReset: (page: Page): Locator =>
    page.getByRole('button', { name: t('landing:storyRecovery.confirmReset'), exact: true }),
}
