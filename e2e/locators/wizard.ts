import type { Locator, Page } from '@playwright/test'

import { t } from '../harness/i18n'

// Wizard locators resolved through the app's own i18n keys
// (docs/testing.md → Selector strategy, Tier 2).
export const wizard = {
  // Step 1 (Frame): mode is a radio segment; its accessible name carries the
  // option label. `adventure` makes needsLead true, surfacing the lead input.
  modeOption: (page: Page, mode: 'adventure' | 'creative'): Locator =>
    page.getByRole('radio', { name: t(`wizard:frame.mode.${mode}.label`), exact: false }),

  leadName: (page: Page): Locator => page.getByPlaceholder(t('wizard:frame.leadName.placeholder')),

  // Step 5 (Opening): both carry an aria-label.
  opening: (page: Page): Locator =>
    page.getByRole('textbox', { name: t('wizard:opening.opening.label') }),

  title: (page: Page): Locator =>
    page.getByRole('textbox', { name: t('wizard:opening.title.label') }),

  next: (page: Page): Locator => page.getByRole('button', { name: t('wizard:footer.next') }),

  finish: (page: Page): Locator => page.getByRole('button', { name: t('wizard:footer.finish') }),

  saveDraft: (page: Page): Locator =>
    page.getByRole('button', { name: t('wizard:footer.saveDraft') }),

  // Hard entry gate (wizard.md → Embedder-unavailable): an AlertDialog over the
  // shell when no usable embedder resolves. The title is reason-independent, so
  // it's the stable assertion target.
  embedGateTitle: (page: Page): Locator =>
    page.getByText(t('wizard:embedGate.title'), { exact: false }),
}
