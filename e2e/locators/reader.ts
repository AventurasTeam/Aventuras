import type { Locator, Page } from '@playwright/test'

import { t } from '../harness/i18n'

// Reader/composer locators. Most resolve through the app's own i18n keys
// (docs/testing.md → Selector strategy, Tier 2). The exceptions are the
// EntryCard per-row action controls, which the component hardcodes in English
// (not `t()` — see docs/implementation/triage.md). They're centralized here so
// a future i18n pass is a one-line change, and the literals still match the
// app's real accessible output today.
const EDIT_ENTRY_LABEL = 'Edit entry'
const DELETE_ENTRY_LABEL = 'Delete entry'
const EDIT_TEXTAREA_LABEL = 'Edit entry content'
const SAVE_LABEL = 'Save'
const RETRY_LABEL = 'Retry'
const DISMISS_LABEL = 'Dismiss'

export const reader = {
  composer: (page: Page): Locator => page.getByPlaceholder(t('reader:composerPlaceholder')),
  send: (page: Page): Locator => page.getByRole('button', { name: t('reader:send') }),
  // Composer swaps Send → Cancel (t('cancel')) while a turn is generating.
  cancel: (page: Page): Locator => page.getByRole('button', { name: t('cancel') }),

  // Composer mode dropdown (web: Radix Select). The trigger carries the "Mode"
  // label; each option renders the mode label + its hint.
  modeTrigger: (page: Page): Locator =>
    page.getByRole('button', { name: new RegExp(t('reader:composerModeLabel')) }),
  modeOption: (page: Page, mode: 'do' | 'say' | 'think' | 'free'): Locator =>
    page.getByRole('option').filter({ hasText: t(`reader:composerMode.${mode}`) }),

  // Each entry renders in a `data-entry-row` div (components/reader/reader-surface.tsx),
  // a stable DOM scope anchor — no component change needed.
  row: (page: Page, entryId: string): Locator => page.locator(`[data-entry-row="${entryId}"]`),
  editEntry: (page: Page, entryId: string): Locator =>
    reader.row(page, entryId).getByRole('button', { name: EDIT_ENTRY_LABEL }),
  deleteEntry: (page: Page, entryId: string): Locator =>
    reader.row(page, entryId).getByRole('button', { name: DELETE_ENTRY_LABEL }),
  editTextarea: (page: Page): Locator => page.getByRole('textbox', { name: EDIT_TEXTAREA_LABEL }),
  saveEdit: (page: Page): Locator => page.getByRole('button', { name: SAVE_LABEL }),

  // System (turn-failure) entry actions.
  retrySystemEntry: (page: Page): Locator => page.getByRole('button', { name: RETRY_LABEL }),
  dismissSystemEntry: (page: Page): Locator => page.getByRole('button', { name: DISMISS_LABEL }),

  // The chrome actions menu (IconAction trigger; on web the accessible name
  // carries the "(Ctrl+K)" shortcut hint, so match on the base label). Undo /
  // Redo live in its contextual group; their row labels are i18n-resolved.
  actionsTrigger: (page: Page): Locator =>
    page.getByRole('button', { name: new RegExp(t('chrome.actions')) }),
  undoRow: (page: Page): Locator => page.getByText(t('reader:actions.undo'), { exact: true }),
  redoRow: (page: Page): Locator => page.getByText(t('reader:actions.redo'), { exact: true }),

  // Rollback (delete-to-entry) confirm modal.
  rollbackConfirm: (page: Page): Locator =>
    page.getByRole('button', { name: t('reader:rollbackConfirm.confirm') }),

  // Bad-branch hydration failure state.
  hydrationFailed: (page: Page): Locator =>
    page.getByText(t('reader:hydrationFailedTitle'), { exact: false }),

  // The generation status pill in its embedder-offline error tone (an
  // interactive Tag, so role=button). The accessible name interpolates the
  // pending-row count, so only the lead-in shared by both plural forms is
  // matched.
  embedderOfflinePill: (page: Page): Locator => {
    const [prefix] = t('chrome.generationStatusPill.error.embedderOffline', {
      count: 1,
    }).split(' — ')
    return page.getByRole('button', { name: prefix, exact: false })
  },
}
