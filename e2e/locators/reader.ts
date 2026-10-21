import type { Locator, Page } from '@playwright/test'

import { t } from '../harness/i18n'

// Reader/composer locators, resolved through the app's own i18n keys
// (docs/testing.md → Selector strategy, Tier 2).

// The monotonicity label interpolates the predecessor's formatted time, which
// no caller knows, so only the lead-in before it can be matched. Cut at a
// sentinel rather than at the punctuation around it, so the key's shape is free
// to change.
const BREAK_SENTINEL = '@@'
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const WORLD_TIME_BREAK_LABEL = new RegExp(
  escapeRegExp(
    t('reader:worldTimeEdit.monotonicityBreak', { previousLabel: BREAK_SENTINEL }).split(
      BREAK_SENTINEL,
    )[0],
  ),
)

// A count no story reaches resolves the `other` plural, split at the number into head and tail;
// `one` covers 1 alone, so matches literally. A non-numeric sentinel resolves the `one` copy.
const COUNT_SENTINEL = 987_654_321
const [WORLD_STATE_HEAD, WORLD_STATE_TAIL = ''] = t('reader:rollbackConfirm.worldState', {
  count: COUNT_SENTINEL,
}).split(String(COUNT_SENTINEL))
const WORLD_STATE_OTHER = `•\\s*${escapeRegExp(WORLD_STATE_HEAD)}(\\d+)${escapeRegExp(WORLD_STATE_TAIL)}`
const WORLD_STATE_ONE = `• ${t('reader:rollbackConfirm.worldState', { count: 1 })}`

function rollbackDialog(page: Page): Locator {
  return page.getByRole('alertdialog').filter({ has: reader.rollbackConfirm(page) })
}

/** The count a world-state line's text reads (`reader.rollbackWorldStateLine`), else null. */
export function worldStateCountOf(text: string): number | null {
  const line = text.replace(/\s+/g, ' ').trim()
  if (line === WORLD_STATE_ONE) return 1
  const match = new RegExp(`^${WORLD_STATE_OTHER}$`).exec(line)
  return match == null ? null : Number(match[1])
}

export const reader = {
  composer: (page: Page): Locator => page.getByPlaceholder(t('reader:composerPlaceholder')),
  send: (page: Page): Locator => page.getByRole('button', { name: t('reader:send') }),
  // Send swaps to Cancel mid-run, and the memory banner's Cancel shares the name, so the
  // composer's box scopes it (docs/testing.md → Tier 3).
  cancel: (page: Page): Locator =>
    page.getByTestId('composer').getByRole('button', { name: t('cancel'), exact: true }),

  // Composer mode dropdown (web: Radix Select). The trigger carries the "Mode"
  // label; each option renders the mode label + its hint.
  modeTrigger: (page: Page): Locator =>
    page.getByRole('button', { name: new RegExp(t('reader:composerModeLabel')) }),
  modeOption: (page: Page, mode: 'do' | 'say' | 'think' | 'free'): Locator =>
    page.getByRole('option').filter({ hasText: t(`reader:composerMode.${mode}`) }),

  // Each entry renders in a `data-entry-row` div (components/reader/reader-surface.tsx),
  // a stable DOM scope anchor — no component change needed.
  row: (page: Page, entryId: string): Locator => page.locator(`[data-entry-row="${entryId}"]`),
  // The rows' scroll container, the parent every `data-entry-row` shares.
  scroller: (page: Page): Locator => page.locator('[data-entry-row]').first().locator('..'),
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
  // Scoped to the entry rows, not the page: since 3.8 the reader hosts a second
  // Save button in the world-time overlay, which portals outside
  // `[data-entry-row]`. exact:true is the other half — "Save & regenerate"
  // renders beside this one on the head turn's user action.
  saveEdit: (page: Page): Locator =>
    page.locator('[data-entry-row]').getByRole('button', { name: t('save'), exact: true }),
  saveAndRegenEdit: (page: Page): Locator =>
    page
      .locator('[data-entry-row]')
      .getByRole('button', { name: t('reader:entryCard.saveAndRegenerate') }),

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
  // Row-scoped: every ai_reply/opening row renders this toggle with the same
  // accessible name, so an unscoped query is ambiguous once more than one exists.
  showState: (page: Page, entryId: string): Locator =>
    reader.row(page, entryId).getByRole('button', { name: t('reader:entryCard.showState') }),
  monotonicityIndicator: (page: Page, entryId: string): Locator =>
    reader.row(page, entryId).getByLabel(WORLD_TIME_BREAK_LABEL),

  // System (turn-failure) entry actions.
  retrySystemEntry: (page: Page): Locator =>
    page.getByRole('button', { name: t('reader:systemEntry.retry') }),
  dismissSystemEntry: (page: Page): Locator =>
    page.getByRole('button', { name: t('reader:systemEntry.dismiss') }),
  switchEmbedderFix: (page: Page): Locator =>
    page.getByRole('button', { name: t('reader:systemEntry.switchEmbedder') }),

  // Undo / Redo live in the chrome Actions menu's contextual group (chrome.ts opens it).
  undoRow: (page: Page): Locator => page.getByText(t('reader:actions.undo'), { exact: true }),
  redoRow: (page: Page): Locator => page.getByText(t('reader:actions.redo'), { exact: true }),
  // The Undo row itself (a listbox option), which carries the disabled state its label doesn't.
  undoMenuRow: (page: Page): Locator =>
    page.getByRole('option', { name: t('reader:actions.undo'), exact: true }),

  // Rollback (delete-to-entry) confirm modal.
  rollbackConfirm: (page: Page): Locator =>
    page.getByRole('button', { name: t('reader:rollbackConfirm.confirm') }),
  // Its Cancel shares `common:cancel` with the composer's and the memory banner's.
  rollbackCancel: (page: Page): Locator =>
    rollbackDialog(page).getByRole('button', { name: t('cancel'), exact: true }),
  // At any count (rollback-confirm.tsx); a regex sees raw text, including the leading newline.
  rollbackWorldStateLine: (page: Page): Locator =>
    rollbackDialog(page)
      .getByText(new RegExp(`${WORLD_STATE_OTHER}\\s*$`))
      .or(rollbackDialog(page).getByText(WORLD_STATE_ONE, { exact: true })),

  // Regenerate cascade confirm modal (RollbackConfirmModal variant="regenerate").
  // exact:true — see regenEntry's comment; the copy contains "regenerate" too.
  regenerateConfirm: (page: Page): Locator =>
    page.getByRole('button', { name: t('reader:regenerateConfirm.confirm'), exact: true }),

  // Next-turn suggestion strip (components/reader/suggestion-strip.tsx). The
  // chip's accessible name is the interpolated chipLabel ("Category: text"),
  // not the chip prose alone, so the locator takes both parts.
  suggestionChip: (page: Page, category: string, text: string): Locator =>
    page.getByRole('button', { name: t('reader:suggestions.chipLabel', { category, text }) }),
  suggestionRefresh: (page: Page): Locator =>
    page.getByRole('button', { name: t('reader:suggestions.refresh') }),
  // The strip's one ⟳: the body's Generate while it shows no chips and nothing holds it, else
  // the header's refresh (suggestion-strip.tsx, bodyOwnsRefresh).
  suggestionRefreshAny: (page: Page): Locator =>
    reader
      .suggestionRefresh(page)
      .or(page.getByRole('button', { name: t('reader:suggestions.generate'), exact: true })),
}
