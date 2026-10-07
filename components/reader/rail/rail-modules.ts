import { entityListModule, type EntityListModule } from '@/components/entity/entity-list-module'
import { loreListModule } from '@/components/entity/lore-list-module'
import {
  happeningListModule,
  type HappeningListModule,
} from '@/components/plot/happening-list-module'
import { plotHref } from '@/components/plot/plot-selection'
import { threadListModule, type ThreadListModule } from '@/components/plot/thread-list-module'
import { worldHref } from '@/components/world/world-selection'
import { t } from '@/lib/i18n'
import type { RailCategory } from '@/lib/reader-rail'

export type RailModuleMap = {
  character: EntityListModule
  location: EntityListModule
  item: EntityListModule
  faction: EntityListModule
  lore: typeof loreListModule
  thread: ThreadListModule
  happening: HappeningListModule
}

// The panels' own module objects, never copies: a divergence is a prop (M4 C2).
export const RAIL_MODULES: RailModuleMap = {
  character: entityListModule('character'),
  location: entityListModule('location'),
  item: entityListModule('item'),
  faction: entityListModule('faction'),
  lore: loreListModule,
  thread: threadListModule,
  happening: happeningListModule,
}

/** The rail's labels: `Places` where World says `Locations`. */
export function railCategoryLabel(category: RailCategory): string {
  return t(`reader:rail.categories.${category}`)
}

/** The rail has no `+ New`, so the panels' subtext would point at an affordance it lacks. */
export function railEmptySubtext(category: RailCategory): string {
  return category === 'lore'
    ? t('reader:rail.empty.loreBody')
    : t('reader:rail.empty.classifierBody')
}

/** The owning panel with the row pre-selected (M4 C6). */
export function railRowHref(branchId: string, category: RailCategory, id: string): string {
  if (category === 'thread' || category === 'happening') {
    return plotHref(branchId, { kind: category, id })
  }
  return worldHref(branchId, { category, id })
}
