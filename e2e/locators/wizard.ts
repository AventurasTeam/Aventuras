import type { Locator, Page } from '@playwright/test'

import { t } from '../harness/i18n'

// Wizard locators resolved through the app's own i18n keys
// (docs/testing.md → Selector strategy, Tier 2).
export const wizard = {
  // Step 1 (Frame): mode is a radio segment; its accessible name carries the
  // option label. `adventure` makes needsLead true, surfacing the lead-required
  // notice — the lead itself is authored in Cast (step 4).
  modeOption: (page: Page, mode: 'adventure' | 'creative'): Locator =>
    page.getByRole('radio', { name: t(`wizard:frame.mode.${mode}.label`), exact: false }),

  // Step 4 (Cast): adding a row opens it expanded (cast-list.tsx → expandAdded),
  // so Name is immediately visible with no separate "Expand" click needed.
  addCast: (page: Page): Locator => page.getByRole('button', { name: t('wizard:cast.add') }),
  addCastKind: (page: Page, kind: 'character' | 'location' | 'item' | 'faction'): Locator =>
    page.getByRole('menuitem', { name: t(`wizard:cast.kinds.${kind}`) }),
  castName: (page: Page): Locator =>
    page.getByRole('textbox', { name: t('wizard:cast.editor.name') }),
  setAsLead: (page: Page): Locator =>
    page.getByRole('button', { name: t('wizard:cast.setAsLead') }),

  // Step 3 (World): lore rows repeat, so Title/Body need an index — each new
  // row is appended (wizardStore.addLore) and stays expanded once opened, so
  // DOM order matches authoring order and `nth()` addresses the right row.
  addLore: (page: Page): Locator => page.getByRole('button', { name: t('wizard:world.lore.add') }),
  loreTitle: (page: Page, index: number): Locator =>
    page.getByRole('textbox', { name: t('wizard:world.lore.title') }).nth(index),
  loreBody: (page: Page, index: number): Locator =>
    page.getByRole('textbox', { name: t('wizard:world.lore.body') }).nth(index),

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
