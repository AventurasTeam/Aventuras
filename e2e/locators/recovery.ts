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
