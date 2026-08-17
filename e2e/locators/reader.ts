import type { Locator, Page } from '@playwright/test'

import { t } from '../harness/i18n'

// Reader/composer locators, resolved through the app's own i18n keys
// (docs/testing.md → Selector strategy, Tier 2).

// The monotonicity label interpolates the predecessor's formatted time, which
// no caller knows, so only the lead-in before it can be matched. Cut at a
// sentinel rather than at the punctuation around it, so the key's shape is free
// to change.
const BREAK_SENTINEL = '@@'
const WORLD_TIME_BREAK_LABEL = new RegExp(
  t('reader:worldTimeEdit.monotonicityBreak', { previousLabel: BREAK_SENTINEL })
    .split(BREAK_SENTINEL)[0]
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
)

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
    reader.row(page, entryId).getByRole('button', { name: t('reader:entryCard.editEntry') }),
  deleteEntry: (page: Page, entryId: string): Locator =>
    reader.row(page, entryId).getByRole('button', { name: t('reader:entryCard.deleteEntry') }),
  // The cascade confirm's "Discard and regenerate" also matches a substring
  // `name` query for "Regenerate"; the row scope — not exact:true — is what
  // excludes it, since that button portals outside `[data-entry-row]`.
  regenEntry: (page: Page, entryId: string): Locator =>
    reader
      .row(page, entryId)
      .getByRole('button', { name: t('reader:entryCard.regenerate'), exact: true }),
  editTextarea: (page: Page): Locator =>
    page.getByRole('textbox', { name: t('reader:entryCard.editContent') }),
  saveEdit: (page: Page): Locator => page.getByRole('button', { name: t('save') }),

  // Per-entry world-time footer. Desktop tier hosts the edit form in a centred
  // Dialog; the phone tier bridges out to a native Sheet, which desktop-only
  // E2E never reaches.
  worldTimeFooter: (page: Page, entryId: string): Locator =>
    reader.row(page, entryId).getByRole('button', { name: t('reader:worldTimeEdit.title') }),
  // One node, named by DialogTitle — no `.first()`. The desktop overlay is a
  // modal, so a second one cannot be open to disambiguate against; strict mode
  // catching that is the point.
  worldTimeDialog: (page: Page): Locator =>
    page.getByRole('dialog', { name: t('reader:worldTimeEdit.title') }),
  // Tier names are calendar-authored content (earth-gregorian: Year / Month /
  // Day / Hour / Minute / Second), capitalized for display by TierTupleInput.
  // Numeric only, hence the name: a labelled tier (Month) renders a Select with
  // no aria-label at all, so passing one yields an empty locator, not a wrong
  // element. A union type would pin this to earth-gregorian's tier names.
  worldTimeNumericField: (page: Page, tier: string): Locator =>
    reader.worldTimeDialog(page).getByRole('textbox', { name: tier }),
  worldTimeSave: (page: Page): Locator =>
    reader.worldTimeDialog(page).getByRole('button', { name: t('save') }),
  monotonicityIndicator: (page: Page, entryId: string): Locator =>
    reader.row(page, entryId).getByLabel(WORLD_TIME_BREAK_LABEL),

  // System (turn-failure) entry actions.
  retrySystemEntry: (page: Page): Locator =>
    page.getByRole('button', { name: t('reader:systemEntry.retry') }),
  dismissSystemEntry: (page: Page): Locator =>
    page.getByRole('button', { name: t('reader:systemEntry.dismiss') }),

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

  // Regenerate cascade confirm modal (RollbackConfirmModal variant="regenerate").
  // exact:true — see regenEntry's comment; the copy contains "regenerate" too.
  regenerateConfirm: (page: Page): Locator =>
    page.getByRole('button', { name: t('reader:regenerateConfirm.confirm'), exact: true }),

  // Bad-branch hydration failure state.
  hydrationFailed: (page: Page): Locator =>
    page.getByText(t('reader:hydrationFailedTitle'), { exact: false }),

  // Next-turn suggestion strip (components/reader/suggestion-strip.tsx). The
  // chip's accessible name is the interpolated chipLabel ("Category: text"),
  // not the chip prose alone, so the locator takes both parts.
  suggestionChip: (page: Page, category: string, text: string): Locator =>
    page.getByRole('button', { name: t('reader:suggestions.chipLabel', { category, text }) }),
  suggestionRefresh: (page: Page): Locator =>
    page.getByRole('button', { name: t('reader:suggestions.refresh') }),
  // The generation status pill in its memory-incomplete state (a warning-tone
  // Tag; interactive, so role=button). The accessible name interpolates the
  // pending-row count, so only the lead-in shared by both plural forms is
  // matched.
  memoryIncompletePill: (page: Page): Locator => {
    const copy = t('chrome.generationStatusPill.error.memoryIncomplete', { count: 1 })
    const [prefix, ...rest] = copy.split(' — ')
    // Without the separator the "lead-in" is the whole count-bearing string,
    // which silently stops matching. Fail loudly on the copy change instead.
    if (rest.length === 0) {
      throw new Error(
        `memoryIncompletePill: no " — " separator in "${copy}"; the count-free lead-in can no longer be isolated`,
      )
    }
    return page.getByRole('button', { name: prefix, exact: false })
  },

  // The same pill in its swap-paused state. No count to interpolate, so the copy
  // matches whole.
  swapPausedPill: (page: Page): Locator =>
    page.getByRole('button', { name: t('chrome.generationStatusPill.error.swapPaused') }),
}
