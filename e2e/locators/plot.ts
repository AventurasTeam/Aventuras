import type { Locator, Page } from '@playwright/test'

import { t } from '../harness/i18n'

// Plot panel (app/plot/[branchId].tsx). testing.md → Selector strategy (Tier 2 default);
// subHeader and segmentCell are Tier-3 exceptions — the segment's cell text collides with the
// sub-header breadcrumb's own kind segment once a row is selected, and the segment's items are
// RadioGroup items (not buttons), so both are scoped through the `plot-segment` testID instead.
export const plot = {
  actionsTrigger: (page: Page): Locator =>
    page.getByRole('button', { name: new RegExp(t('chrome.actions')) }),
  goToPlotRow: (page: Page): Locator =>
    page.getByRole('option', { name: t('chrome.goTo.openPlot'), exact: true }),
  goToReaderRow: (page: Page): Locator =>
    page.getByRole('option', { name: t('chrome.goTo.openReader'), exact: true }),

  // ListRow's Pressable carries the label as its accessible name.
  row: (page: Page, title: string): Locator =>
    page.getByRole('button', { name: title, exact: true }),

  segmentCell: (page: Page, kind: 'thread' | 'happening'): Locator =>
    page.getByTestId('plot-segment').getByText(t(`plot:kinds.${kind}`), { exact: true }),

  // Filter chips set aria-pressed (chip.tsx); the exact name keeps them apart from tier headers.
  chip: (page: Page, filter: string): Locator =>
    page.getByRole('button', { name: t(`plot:filters.${filter as 'all'}`), exact: true }),

  // All-view group header (module-list.tsx), matched via aria-expanded like World's tierHeader.
  tierHeader: (page: Page, label: string): Locator =>
    page.locator('[aria-expanded]').filter({ hasText: label }),

  subHeader: (page: Page): Locator => page.getByTestId('plot-sub-header'),

  addTrigger: (page: Page, kind: 'thread' | 'happening'): Locator =>
    page.getByRole('button', { name: t(`plot:add.${kind}`), exact: true }),
  addMenuBlank: (page: Page): Locator =>
    page.getByRole('menuitem', { name: t('plot:addMenu.blank'), exact: true }),

  // Tab triggers carry a count suffix on the link tabs.
  tab: (page: Page, tab: 'overview' | 'involvements' | 'awareness' | 'history'): Locator =>
    page.getByRole('tab', { name: new RegExp(`^${t(`plot:detail.tabs.${tab}`)}`) }),

  // testID was dropped (Task 21): the Overview description Textarea is named by its own
  // aria-label. Only one of Thread/Happening Overview renders at a time, so it needs no
  // further scoping to the detail pane.
  description: (page: Page): Locator =>
    page.getByRole('textbox', { name: t('plot:fields.description') }),

  addAwareness: (page: Page): Locator =>
    page.getByRole('button', { name: t('plot:awareness.add'), exact: true }),
  // Row-qualified (happening-detail-pane.tsx): unnamed until an entity is picked, then
  // "Remove {name}" — the caller passes the row's character name.
  removeAwareness: (page: Page, name: string): Locator =>
    page.getByRole('button', { name: t('plot:awareness.removeNamed', { name }), exact: true }),
  openInWorldAwareness: (page: Page, name: string): Locator =>
    page.getByRole('button', { name: t('plot:awareness.openInWorld', { name }), exact: true }),

  removeInvolvement: (page: Page, name: string): Locator =>
    page.getByRole('button', { name: t('plot:involvements.removeNamed', { name }), exact: true }),
  openInWorldInvolvement: (page: Page, name: string): Locator =>
    page.getByRole('button', { name: t('plot:involvements.openInWorld', { name }), exact: true }),

  // An empty PickerField is named by its label alone; a set one reads "label: value"
  // (common:picker.fieldLabel), so exact matching targets the freshly added row.
  characterPicker: (page: Page): Locator =>
    page.getByRole('button', { name: t('plot:fields.character'), exact: true }),
  pickerOption: (page: Page, name: string): Locator =>
    page.getByRole('option', { name: new RegExp(name) }),
}
