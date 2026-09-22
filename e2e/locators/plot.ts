import type { Locator, Page } from '@playwright/test'

import type { HappeningFilter, ThreadFilter } from '@/lib/list-modules'

import { t } from '../harness/i18n'

// Plot panel (app/plot/[branchId].tsx). testing.md → Selector strategy (Tier 2 default);
// subHeader is the one Tier-3 exception (no role, no unique name of its own).
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

  // The kind Select renders as a RadioGroup in segment mode (select.tsx SegmentBranch).
  segmentCell: (page: Page, kind: 'thread' | 'happening'): Locator =>
    page.getByRole('radio', { name: t(`plot:kinds.${kind}`), exact: true }),

  // Filter chips set aria-pressed (chip.tsx); the exact name keeps them apart from tier headers.
  chip: (page: Page, filter: HappeningFilter | ThreadFilter): Locator =>
    page.getByRole('button', { name: t(`plot:filters.${filter}`), exact: true }),

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

  // InlineEditableName (inline-editable-name.tsx): not-editing renders a `button` named by the
  // placeholder; entering edit mode swaps in an Input that carries the same `placeholder` prop,
  // which stays a stable target — unlike a bare `input:focus`, which would bind to whatever
  // control the page happens to have focused (the list-pane search is a candidate).
  nameTrigger: (page: Page): Locator =>
    page.getByRole('button', { name: t('plot:detail.namePlaceholder'), exact: true }),
  nameInput: (page: Page): Locator => page.getByPlaceholder(t('plot:detail.namePlaceholder')),

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
  // (common:picker.fieldLabel) — characterPicker targets a freshly added, still-blank row,
  // characterPickerSet targets an existing row by its current character's name.
  characterPicker: (page: Page): Locator =>
    page.getByRole('button', { name: t('plot:fields.character'), exact: true }),
  characterPickerSet: (page: Page, name: string): Locator =>
    page.getByRole('button', {
      name: t('picker.fieldLabel', { label: t('plot:fields.character'), value: name }),
      exact: true,
    }),
  // A status-tagged option (e.g. a staged entity) renders extra text after the name, so this
  // stays a substring match — Playwright's default for a plain string `name` — rather than
  // exact or a hand-rolled RegExp(name), which would throw on a metacharacter in `name`.
  pickerOption: (page: Page, name: string): Locator => page.getByRole('option', { name }),
}
