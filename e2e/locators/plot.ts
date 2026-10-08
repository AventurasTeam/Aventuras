import type { Locator, Page } from '@playwright/test'

import type { HappeningFilter, PlotKind, ThreadFilter } from '@/lib/list-modules'

import { t } from '../harness/i18n'

// Plot panel (app/plot/[branchId].tsx). testing.md → Selector strategy — subHeader is the
// one testID (no role, no unique name of its own).
export const plot = {
  // ListRow's Pressable carries the label as its accessible name.
  row: (page: Page, title: string): Locator =>
    page.getByRole('button', { name: title, exact: true }),

  // The kind Select renders as a RadioGroup in segment mode (select.tsx SegmentBranch).
  segmentCell: (page: Page, kind: 'thread' | 'happening'): Locator =>
    page.getByRole('radio', { name: t(`plot:kinds.${kind}`), exact: true }),

  // Filter chips set aria-pressed (chip.tsx); the exact name keeps them apart from tier headers.
  chip: (page: Page, filter: HappeningFilter | ThreadFilter): Locator =>
    page.getByRole('button', { name: t(`plot:filters.${filter}`), exact: true }),

  // All-view group header (module-list.tsx). Its name folds in the row count, which keeps it
  // apart from the filter chip and the detail pane's Status select that share its label.
  tierHeader: (page: Page, label: string): Locator =>
    page.getByRole('button', { name: new RegExp(`^${label} \\d+$`) }),

  // The list pane's search box, named by its placeholder (plot-list-copy.ts).
  search: (page: Page, kind: 'thread' | 'happening'): Locator =>
    page.getByPlaceholder(
      t('plot:search.placeholder', {
        category: t(`plot:kinds.${kind}`).toLocaleLowerCase('en'),
      }),
    ),

  subHeader: (page: Page): Locator => page.getByTestId('plot-sub-header'),
  // The sub-header's kind segment: a link only while a row follows it (breadcrumb.tsx).
  subHeaderKind: (page: Page, kind: 'thread' | 'happening'): Locator =>
    plot.subHeader(page).getByRole('link', { name: t(`plot:kinds.${kind}`), exact: true }),

  // The top bar's story segment: a Breadcrumb parent renders as a link named by its label.
  storyCrumb: (page: Page, title: string): Locator =>
    page.getByRole('link', { name: title, exact: true }),

  addTrigger: (page: Page, kind: 'thread' | 'happening'): Locator =>
    page.getByRole('button', { name: t(`plot:add.${kind}`), exact: true }),
  addMenuBlank: (page: Page): Locator =>
    page.getByRole('menuitem', { name: t('plot:addMenu.blank'), exact: true }),
  // Exact, so it matches only while enabled: a disabled option's name appends its reason.
  addMenuFromJson: (page: Page): Locator =>
    page.getByRole('menuitem', { name: t('plot:addMenu.fromJson'), exact: true }),

  // ImportDialog (import-dialog.tsx), named by the per-kind title Plot passes it (plot-import.ts).
  importDialog: (page: Page, kind: PlotKind): Locator =>
    page.getByRole('dialog', { name: t(`plot:import.title.${kind}`), exact: true }),
  importFromClipboard: (page: Page, kind: PlotKind): Locator =>
    plot
      .importDialog(page, kind)
      .getByRole('button', { name: t('common:importDialog.fromClipboard'), exact: true }),

  // Tab triggers carry a count suffix on the link tabs.
  tab: (page: Page, tab: 'overview' | 'involvements' | 'awareness' | 'history'): Locator =>
    page.getByRole('tab', { name: new RegExp(`^${t(`plot:detail.tabs.${tab}`)}`) }),

  // The Overview description Textarea is named by its own aria-label; only one of
  // Thread/Happening Overview renders at once, so it needs no further scoping.
  description: (page: Page): Locator =>
    page.getByRole('textbox', { name: t('plot:fields.description') }),

  // InlineEditableName: not-editing and empty renders a `button` named by the placeholder; editing
  // swaps in an Input with the same `placeholder` — a stable target, unlike `input:focus`
  // which could bind to whatever the page happens to have focused (e.g. the list-pane search).
  nameTrigger: (page: Page): Locator =>
    page.getByRole('button', { name: t('plot:detail.namePlaceholder'), exact: true }),
  nameInput: (page: Page): Locator => page.getByPlaceholder(t('plot:detail.namePlaceholder')),

  addAwareness: (page: Page): Locator =>
    page.getByRole('button', { name: t('plot:awareness.add'), exact: true }),
  // Row-qualified (link-card.tsx): generic until a character is picked, then "Remove
  // {name}" — caller passes the row's character name.
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
  // A status-tagged option (e.g. staged entity) adds text after the name, so this keeps
  // Playwright's substring match — RegExp(name) would misread a metacharacter in `name`.
  pickerOption: (page: Page, name: string): Locator => page.getByRole('option', { name }),

  moreActions: (page: Page): Locator =>
    page.getByRole('button', { name: t('plot:detail.menu.label'), exact: true }),
  // Exact, so it matches only while enabled: a disabled entry's name appends its reason
  // (common:disabledWithReason).
  deleteItem: (page: Page, kind: 'thread' | 'happening'): Locator =>
    page.getByRole('menuitem', {
      name: t(
        kind === 'thread' ? 'plot:detail.menu.deleteThread' : 'plot:detail.menu.deleteHappening',
      ),
      exact: true,
    }),
  deleteDialog: (page: Page): Locator => page.getByRole('alertdialog'),
  deleteConfirm: (page: Page, kind: 'thread' | 'happening'): Locator =>
    plot.deleteDialog(page).getByRole('button', {
      name: t(kind === 'thread' ? 'plot:delete.confirmThread' : 'plot:delete.confirmHappening'),
      exact: true,
    }),
}
