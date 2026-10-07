import type { Locator, Page } from '@playwright/test'

import type { ThreadFilter } from '@/lib/list-modules'
import type { RailCategory, StripCategory } from '@/lib/reader-rail'

import { t } from '../harness/i18n'

// The reader's Browse rail (components/reader/rail/). Its rows, chips and search share names with
// World's and Plot's, so every locator but the portaled category option is scoped inside the
// expanded rail's or the strip's testID (docs/testing.md → Selector strategy, Tier 3).

const COUNT_SENTINEL = '@@'

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// A counted cell's name carries its count; given none, any count matches.
function stripCellName(category: StripCategory, count: number | undefined): string | RegExp {
  const key = `reader:rail.strip.${category}`
  if (category === 'location' || category === 'faction') return t(key)
  if (count !== undefined) return t(key, { count })
  const [before, after = ''] = t(key, { count: COUNT_SENTINEL }).split(COUNT_SENTINEL)
  return new RegExp(`^${escapeRegExp(before)}\\d+\\+?${escapeRegExp(after)}$`)
}

// The list copy lowercases the rail's own label, so `location` reads "Search places…".
function searchPlaceholder(category: RailCategory): string {
  const namespace = category === 'thread' || category === 'happening' ? 'plot' : 'world'
  return t(`${namespace}:search.placeholder`, {
    category: t(`reader:rail.categories.${category}`).toLocaleLowerCase('en'),
  })
}

export const rail = {
  column: (page: Page): Locator => page.getByTestId('reader-rail'),
  strip: (page: Page): Locator => page.getByTestId('rail-strip'),

  // A dropdown Select is named by its label whatever its value (select.tsx), so the trigger
  // can't report the category; `search` does.
  categoryTrigger: (page: Page): Locator =>
    rail.column(page).getByLabel(t('reader:rail.categorySelect'), { exact: true }),
  // The listbox portals out of the rail; only one Select is open at a time.
  categoryOption: (page: Page, category: RailCategory): Locator =>
    page.getByRole('option', { name: t(`reader:rail.categories.${category}`), exact: true }),
  search: (page: Page, category: RailCategory): Locator =>
    rail.column(page).getByPlaceholder(searchPlaceholder(category), { exact: true }),

  // Thread filter chips set aria-pressed (chip.tsx); the exact name keeps them apart from the
  // All view's tier headers, whose names carry a count.
  threadChip: (page: Page, filter: ThreadFilter): Locator =>
    rail.column(page).getByRole('button', { name: t(`plot:filters.${filter}`), exact: true }),

  // ListRow's Pressable carries the label as its accessible name.
  row: (page: Page, name: string): Locator =>
    rail.column(page).getByRole('button', { name, exact: true }),

  collapse: (page: Page): Locator =>
    rail.column(page).getByRole('button', { name: t('reader:rail.collapse'), exact: true }),
  expand: (page: Page): Locator =>
    rail.strip(page).getByRole('button', { name: t('reader:rail.expand'), exact: true }),
  stripCell: (page: Page, category: StripCategory, count?: number): Locator =>
    rail.strip(page).getByRole('button', { name: stripCellName(category, count), exact: true }),
}
