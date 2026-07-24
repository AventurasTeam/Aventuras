import type { Locator, Page } from '@playwright/test'

import { t } from '../harness/i18n'

// Story Settings + the embedder swap surfaces (components/story-settings/memory-panel.tsx,
// components/embedder/swap-dialog.tsx, components/embedder/swap-resume-dialog.tsx).
// Role/name locators resolve through the app's own i18n keys; testID locators
// cover the swap flow's no-role and repeated controls (docs/testing.md →
// Selector strategy, Tiers 2-3).
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

  reindexNow: (page: Page): Locator => page.getByTestId('reindex-now'),

  // SwapDialog's CandidateRow testID embeds the raw candidate model id.
  // getByTestId matches through Playwright's own selector engine rather than a
  // literal CSS string, so ids containing "/" need no escaping.
  swapCandidate: (page: Page, modelId: string): Locator =>
    page.getByTestId(`swap-candidate-${modelId}`),

  swapNext: (page: Page): Locator =>
    page.getByRole('button', { name: t('storySettings:swap.next') }),

  swapReindex: (page: Page): Locator => page.getByTestId('swap-reindex'),
  swapKeep: (page: Page): Locator => page.getByTestId('swap-keep'),
  swapRelabel: (page: Page): Locator => page.getByTestId('swap-relabel'),
  swapResume: (page: Page): Locator => page.getByTestId('swap-resume'),
  swapCancelSwap: (page: Page): Locator => page.getByTestId('swap-cancel-swap'),
}
