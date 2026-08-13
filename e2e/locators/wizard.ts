import type { Locator, Page } from '@playwright/test'

import { t } from '../harness/i18n'

export type CastKind = 'character' | 'location' | 'item' | 'faction'

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
  addCastKind: (page: Page, kind: CastKind): Locator =>
    page.getByRole('menuitem', { name: t(`wizard:cast.kinds.${kind}`) }),

  // Rows repeat every field/button name (Name, Status, Set as lead, …), and
  // `useRowExpansion` never auto-collapses a row that's already open, so with
  // several rows authored a page-wide role query is strict-mode-unique only by
  // accident. Scope through the row's `data-cast-id` anchor — ExpandableRow's
  // testID="cast-row" + dataSet={{ castId }} (cast-list.tsx) — the sanctioned
  // Tier-3 "repeated-row scope anchor" case (docs/testing.md → Selector
  // strategy). Mirrors reader.ts's `data-entry-row` anchor and the
  // component's own Storybook interaction tests (step-cast.stories.tsx).
  castRows: (page: Page): Locator => page.getByTestId('cast-row'),
  castRow: (page: Page, castId: string): Locator => page.locator(`[data-cast-id="${castId}"]`),
  castName: (page: Page, castId: string): Locator =>
    wizard.castRow(page, castId).getByRole('textbox', { name: t('wizard:cast.editor.name') }),
  // Status is a 2-option Select; resolveMode picks 'segment' at ≤3 options
  // (select.tsx), which still renders RadioGroupBase items under the hood —
  // role="radio" in a role="radiogroup" named "Status" (the `label` prop) —
  // not a listbox, so there is no role="option" to match here.
  castStatusOption: (page: Page, castId: string, status: 'active' | 'staged'): Locator =>
    wizard.castRow(page, castId).getByRole('radio', {
      name: t(`wizard:cast.editor.status${status === 'active' ? 'Active' : 'Staged'}`),
    }),
  setAsLead: (page: Page, castId: string): Locator =>
    wizard.castRow(page, castId).getByRole('button', { name: t('wizard:cast.setAsLead') }),

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
