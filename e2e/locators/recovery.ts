import type { Locator, Page } from '@playwright/test'

import { t } from '../harness/i18n'

// The pre-Router boot surface (components/shells/settings-recovery-screen.tsx),
// resolved through the same common-namespace keys it renders. No testIDs: the
// title is unique text and the two actions are named buttons. `Open file` is
// never clicked — it opens a file manager on the virtual display.
export const recovery = {
  title: (page: Page): Locator => page.getByText(t('recovery.title'), { exact: true }),
  resetSettings: (page: Page): Locator =>
    page.getByRole('button', { name: t('recovery.resetSettings') }),
}
