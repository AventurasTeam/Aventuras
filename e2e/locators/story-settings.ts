import type { Locator, Page } from '@playwright/test'

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
  // story", and getByRole matches the name exactly, so the two can't collide.
  reindexNow: (page: Page): Locator =>
    page.getByRole('button', { name: t('storySettings:memory.reindexNow') }),

  // The standalone re-index is gated by a confirm dialog; this is its start button.
  reindexConfirmStart: (page: Page): Locator => page.getByTestId('reindex-confirm-start'),

  // SwapDialog's CandidateRow testID embeds the raw candidate model id.
  // getByTestId matches through Playwright's own selector engine rather than a
  // literal CSS string, so ids containing "/" need no escaping.
  swapCandidate: (page: Page, modelId: string): Locator =>
    page.getByTestId(`swap-candidate-${modelId}`),

  swapNext: (page: Page): Locator =>
    page.getByRole('button', { name: t('storySettings:swap.next') }),

  // Only the options-pane action the suite drives. Re-index, Keep and the resume
  // dialog's controls are deliberately absent: nothing reaches them yet, and a
  // locator for an uncovered control reads as coverage.
  swapRelabel: (page: Page): Locator =>
    page.getByRole('button', { name: t('storySettings:swap.relabel') }),
}
