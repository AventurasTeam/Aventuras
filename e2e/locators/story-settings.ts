import type { Locator, Page } from '@playwright/test'

import { embeddingTargetKey, type EmbeddingTarget } from '@/lib/db'

import { t } from '../harness/i18n'

// Story Settings + the embedder swap surfaces (components/story-settings/memory-panel.tsx,
// components/embedder/swap-dialog.tsx). Every control resolves through the app's
// own i18n keys (docs/testing.md → Selector strategy, Tier 2). The two testIDs
// are the documented Tier-3 exceptions: the panel container carries no role or
// accessible name, and a candidate row's only name is the model's display label,
// which repeats across rows and isn't stable copy.
export const storySettings = {
  // Chrome gear on an in-story screen (e.g. the reader) — routes to
  // /story-settings/[storyId].
  openFromReader: (page: Page): Locator =>
    page.getByRole('button', { name: t('chrome.storySettings') }),

  memoryTab: (page: Page): Locator =>
    page.getByRole('tab', { name: t('storySettings:tabs.memory') }),

  memoryPanel: (page: Page): Locator => page.getByTestId('memory-panel'),

  switchEmbedder: (page: Page): Locator =>
    page.getByRole('button', { name: t('storySettings:memory.switchEmbedder') }),

  // "Re-index this story now" — distinct from the swap dialog's "Re-index this
  // story". getByRole's default `name` match is a case-insensitive substring, not
  // exact, so a locator searching the swap dialog's SHORTER string would also
  // match this button (it's a prefix of this copy); this locator searches the
  // longer "now" string instead, which the swap dialog's button name doesn't
  // contain, so it can't resolve both.
  reindexNow: (page: Page): Locator =>
    page.getByRole('button', { name: t('storySettings:memory.reindexNow') }),

  // The standalone re-index is gated by a confirm dialog; this is its start button.
  reindexConfirmStart: (page: Page): Locator => page.getByTestId('reindex-confirm-start'),

  // The swap dialog's own title — the observable half of an action that both
  // routes to the memory panel and opens the dialog on top of it.
  swapDialogTitle: (page: Page): Locator => page.getByText(t('storySettings:swap.title')),

  // SwapDialog's CandidateRow testID embeds the whole target, not the model id:
  // a model installed locally AND served by the provider is two rows, and a bare
  // id would match both and trip strict mode. getByTestId matches through
  // Playwright's own selector engine rather than a literal CSS string, so ids
  // containing "/" or ":" need no escaping.
  swapCandidate: (page: Page, target: EmbeddingTarget): Locator =>
    page.getByTestId(`swap-candidate-${embeddingTargetKey(target)}`),

  swapNext: (page: Page): Locator =>
    page.getByRole('button', { name: t('storySettings:swap.next') }),

  // Only the options-pane action the suite drives. Re-index, Keep and the resume
  // dialog's controls are deliberately absent: nothing reaches them yet, and a
  // locator for an uncovered control reads as coverage.
  swapRelabel: (page: Page): Locator =>
    page.getByRole('button', { name: t('storySettings:swap.relabel') }),

  // The story-open resume prompt (components/embedder/swap-resume-host.tsx),
  // mounted app-wide off the open story rather than by any one route.
  resumePrompt: (page: Page): Locator => page.getByText(t('storySettings:swap.resumeTitle')),

  resumeLater: (page: Page): Locator =>
    page.getByRole('button', { name: t('storySettings:swap.resumeLater') }),

  generationTab: (page: Page): Locator =>
    page.getByRole('tab', { name: t('storySettings:tabs.generation') }),

  authoringAidsPanel: (page: Page): Locator => page.getByTestId('authoring-aids-panel'),

  suggestionsToggle: (page: Page): Locator =>
    page.getByRole('switch', { name: t('storySettings:generation.suggestions') }),

  // Tier 3: the label inputs repeat per row and share one placeholder as their
  // only accessible name, so a role query would match every row at once.
  categoryLabel: (page: Page, categoryId: string): Locator =>
    page.getByTestId(`suggestion-category-label-${categoryId}`),

  countIncrement: (page: Page): Locator =>
    page.getByRole('button', { name: t('storySettings:generation.countIncrement') }),

  // The save button's accessible name carries a platform shortcut hint
  // (`Save Ctrl+S`), so it anchors rather than matching exactly.
  save: (page: Page): Locator =>
    page.getByRole('button', { name: new RegExp(`^${t('saveBar.save')}`) }),

  discard: (page: Page): Locator => page.getByRole('button', { name: t('saveBar.discard') }),

  // ScreenShell's chrome back arrow, an IconAction whose accessible name is t('chrome.back').
  back: (page: Page): Locator => page.getByRole('button', { name: t('chrome.back') }),

  // The chrome Actions menu. Its trigger's accessible name carries the "(Ctrl+K)"
  // shortcut hint on web, so it anchors on the base label rather than matching
  // exactly (same shape as the reader's).
  actionsTrigger: (page: Page): Locator =>
    page.getByRole('button', { name: new RegExp(t('chrome.actions')) }),

  // The menu's only route jump, and the one this surface routes through its
  // save-session guard. Gated on the diagnostics flag — seed it on first.
  diagnosticsHubRow: (page: Page): Locator =>
    page.getByText(t('settings:diagnosticsHub.actionLabel'), { exact: true }),

  // getByText alone is ambiguous here: the dialog body's copy also contains
  // the substring "unsaved changes" (getByText is a case-insensitive
  // substring match), so it resolves both the title and the description.
  // Anchoring on the alertdialog role stays unambiguous even with the
  // panel's other two AlertDialogs (delete/reset confirm) in the tree.
  unsavedDialog: (page: Page): Locator =>
    page.getByRole('alertdialog').filter({ hasText: t('storySettings:save.unsavedTitle') }),

  // Scoped inside the dialog, not a bare role+name query: the save bar behind
  // it stays in the accessibility tree while the dialog is open (confirmed by
  // an actual run — Radix's background-hiding doesn't reach this DOM shape),
  // so an unscoped query resolves both this button and the save bar's own
  // "Discard".
  unsavedDiscard: (page: Page): Locator =>
    storySettings
      .unsavedDialog(page)
      .getByRole('button', { name: t('storySettings:save.unsavedDiscard') }),

  // The dialog's AlertDialogCancel uses the shared `common:cancel`, not a
  // storySettings-namespaced key.
  unsavedCancel: (page: Page): Locator =>
    storySettings.unsavedDialog(page).getByRole('button', { name: t('cancel') }),
}
