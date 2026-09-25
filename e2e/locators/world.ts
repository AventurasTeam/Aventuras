import type { Locator, Page } from '@playwright/test'

import type { EntityTab } from '@/components/world/detail/entity-tabs'

import { t } from '../harness/i18n'

// World panel (app/world/[branchId].tsx). testing.md → Selector strategy (Tier 2 default);
// subHeader/detailName are Tier-3 exceptions; detailName's name would collide with a list row.
export const world = {
  // Actions menu rows are listbox options (searchable-overlay-list.tsx) named by their label.
  addEntityRow: (page: Page): Locator =>
    page.getByRole('option', { name: t('world:actions.addEntity'), exact: true }),
  addLoreRow: (page: Page): Locator =>
    page.getByRole('option', { name: t('world:actions.addLore'), exact: true }),

  // ListRow's Pressable carries the label as its accessible name.
  row: (page: Page, name: string): Locator => page.getByRole('button', { name, exact: true }),

  // `⚠ N need review` — pressable Tag whose accessible name drops the glyph
  // (collision-review-pill.tsx); the same name on every tier.
  reviewPill: (page: Page, count: number): Locator =>
    page.getByRole('button', { name: t('world:collision.needReview', { count }), exact: true }),

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
        category: t(`world:categories.${category}`).toLocaleLowerCase('en'),
      }),
    ),

  // All-view group accordion header (module-list.tsx); matched via aria-expanded, since the
  // sibling filter Chip shares the same label text but sets aria-pressed instead (chip.tsx).
  // The header's name also folds in the row count, so it can't reuse `row`'s role+name pattern.
  tierHeader: (page: Page, tierLabel: string): Locator =>
    page.locator('[aria-expanded]').filter({ hasText: tierLabel }),

  // The collapsed-tier `⚠ N` badge (module-list.tsx); its accessible name scopes
  // the count to the tier, distinct from the top-bar reviewPill's.
  tierBadge: (page: Page, tierLabel: string, count: number): Locator =>
    page.getByRole('button', {
      name: t('list.groupNeedReview', { count, group: tierLabel }),
      exact: true,
    }),

  subHeader: (page: Page): Locator => page.getByTestId('world-sub-header'),

  detailName: (page: Page): Locator => page.getByTestId('world-detail-name'),

  // The detail pane's recently-classified badge (world-detail-placeholder.tsx)
  // — a plain Tag, no role of its own.
  recentlyClassifiedBadge: (page: Page): Locator =>
    page.getByText(t('world:detail.recentlyClassified'), { exact: true }),

  // ImporterMenu options (importer-menu.tsx). A disabled option's accessible name resolves to its
  // reason, and Blank is enabled only on entity categories — assert the visible label text instead.
  addMenuOption: (page: Page, key: 'blank' | 'fromJson' | 'fromVault'): Locator =>
    page.getByText(t(`world:addMenu.${key}`), { exact: true }),

  // Tab triggers may carry a `(n)` count suffix.
  tab: (page: Page, tab: EntityTab): Locator =>
    page.getByRole('tab', { name: new RegExp(`^${t(`world:detail.tabs.${tab}`)}`) }),

  description: (page: Page): Locator =>
    page.getByRole('textbox', { name: t('world:fields.description'), exact: true }),
  visualField: (page: Page, key: 'hair' | 'face' | 'eyes'): Locator =>
    page.getByRole('textbox', { name: t(`world:fields.visual.${key}`), exact: true }),
  // TagInput's inner text input carries the field label as its accessible name.
  tagsInput: (page: Page): Locator =>
    page.getByRole('textbox', { name: t('world:fields.tags'), exact: true }),

  addTrigger: (page: Page, category: 'character' | 'location' | 'item' | 'faction'): Locator =>
    page.getByRole('button', { name: t(`world:add.${category}`), exact: true }),
  addMenuBlank: (page: Page): Locator =>
    page.getByRole('menuitem', { name: t('world:addMenu.blank'), exact: true }),

  // InlineEditableName: empty and not editing, a button named by its placeholder.
  nameTrigger: (page: Page): Locator =>
    page.getByRole('button', { name: t('world:detail.namePlaceholder'), exact: true }),
  nameInput: (page: Page): Locator => page.getByPlaceholder(t('world:detail.namePlaceholder')),

  moreActions: (page: Page): Locator =>
    page.getByRole('button', { name: t('world:detail.menu.label'), exact: true }),
  menuItem: (page: Page, key: 'setLead' | 'viewJson'): Locator =>
    page.getByRole('menuitem', { name: t(`world:detail.menu.${key}`), exact: true }),

  // The list row's lead Tag (entity-row.tsx meta slot).
  leadTag: (page: Page, name: string): Locator =>
    world.row(page, name).getByText(t('world:lead.you'), { exact: true }),
}
