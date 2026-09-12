import type { Locator, Page } from '@playwright/test'

import { t } from '../harness/i18n'

// World panel (app/world/[branchId].tsx). testing.md → Selector strategy (Tier 2 default);
// subHeader/detailName are Tier-3 exceptions; detailName's name would collide with a list row.
export const world = {
  // The chrome Actions menu on World; its accessible name carries the
  // "(Ctrl+K)" hint on web, so it anchors on the base label.
  actionsTrigger: (page: Page): Locator =>
    page.getByRole('button', { name: new RegExp(t('chrome.actions')) }),

  // GO TO rows, from the shared chrome copy — plain text (see actions-menu.tsx's MenuRow, no
  // distinct role), matching reader.ts's undoRow/redoRow precedent.
  goToWorldRow: (page: Page): Locator =>
    page.getByText(t('chrome.goTo.openWorld'), { exact: true }),
  goToStorySettingsRow: (page: Page): Locator =>
    page.getByText(t('chrome.goTo.openStorySettings'), { exact: true }),
  goToReaderRow: (page: Page): Locator =>
    page.getByText(t('chrome.goTo.openReader'), { exact: true }),

  // ListRow's Pressable carries the label as its accessible name.
  row: (page: Page, name: string): Locator => page.getByRole('button', { name, exact: true }),

  // `⚠ N need review` — pressable Tag (testing.md → E2E target: desktop-only);
  // the phone tier's glyph-only `⚠ N` copy never applies here.
  reviewPill: (page: Page, count: number): Locator =>
    page.getByRole('button', { name: `⚠ ${t('world:collision.needReview', { count })}` }),

  collisionStrip: (page: Page, otherName: string): Locator =>
    page.getByRole('link', { name: t('collisionRow.collidesWith', { name: otherName }) }),

  // Select's trigger aria-label is fixed to "Category" (select.tsx: label always wins over text
  // content) — assert the selected value via visible text (toHaveText), not this locator's name.
  categoryTrigger: (page: Page): Locator => page.getByLabel(t('world:categorySelect')),
  categoryOption: (page: Page, category: string): Locator =>
    page.getByRole('option', { name: t(`world:categories.${category}`) }),

  search: (page: Page, category: string): Locator =>
    page.getByPlaceholder(
      t('world:search.placeholder', {
        category: t(`world:categories.${category}`).toLocaleLowerCase(),
      }),
    ),

  // All-view group accordion header (module-list.tsx); matched via aria-expanded, since the
  // sibling filter Chip shares the same label text but sets aria-pressed instead (chip.tsx).
  // The header's name also folds in the row count, so it can't reuse `row`'s role+name pattern.
  tierHeader: (page: Page, tierLabel: string): Locator =>
    page.locator('[aria-expanded]').filter({ hasText: tierLabel }),

  // The collapsed-tier `⚠ N` badge (module-list.tsx) — exact text, no
  // "need review" suffix (that's the top-bar reviewPill's copy).
  tierBadge: (page: Page, count: number): Locator =>
    page.getByRole('button', { name: `⚠ ${count}`, exact: true }),

  subHeader: (page: Page): Locator => page.getByTestId('world-sub-header'),

  detailName: (page: Page): Locator => page.getByTestId('world-detail-name'),

  // The detail pane's recently-classified badge (world-detail-placeholder.tsx)
  // — a plain Tag, no role of its own.
  recentlyClassifiedBadge: (page: Page): Locator =>
    page.getByText(t('world:detail.recentlyClassified'), { exact: true }),

  // The contextual "Add entity…" row — same plain-text MenuRow shape as the GO TO rows above.
  addEntityRow: (page: Page): Locator =>
    page.getByText(t('world:actions.addEntity'), { exact: true }),

  // ImporterMenu options (importer-menu.tsx); every world option is present-but-disabled, so its
  // accessible name resolves to the disabled reason — assert the visible label text instead.
  addMenuOption: (page: Page, key: 'blank' | 'fromJson' | 'fromVault'): Locator =>
    page.getByText(t(`world:addMenu.${key}`), { exact: true }),
}
