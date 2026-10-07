import type { RecentlyClassified, RowCategory, SignalEntity } from '@/lib/row-signals'

// reader-composer.md → Collapsed state: Group B has no count, since the location is a 0-or-1
// singleton and factions aren't scene-tagged.
export type StripCountedCategory = 'character' | 'item'
export type StripGlyphCategory = 'location' | 'faction'
export type StripCategory = StripCountedCategory | StripGlyphCategory

export type StripCountedCell = {
  category: StripCountedCategory
  count: number
  tint: RecentlyClassified | undefined
}
export type StripGlyphCell = { category: StripGlyphCategory; tint: RecentlyClassified | undefined }

export type RailStripModel = {
  counted: readonly [StripCountedCell, StripCountedCell]
  quickAccess: readonly [StripGlyphCell, StripGlyphCell]
}

export const STRIP_COUNT_CAP = 9

export function railStripModel(input: {
  inScene: ReadonlySet<string>
  entities: readonly SignalEntity[]
  byCategory: ReadonlyMap<RowCategory, RecentlyClassified>
}): RailStripModel {
  const kinds = new Map(input.entities.map((e) => [e.id, e.kind]))
  let characters = 0
  let items = 0
  for (const id of input.inScene) {
    const kind = kinds.get(id)
    if (kind === 'character') characters += 1
    else if (kind === 'item') items += 1
  }
  const tint = (category: StripCategory) => input.byCategory.get(category)
  return {
    counted: [
      { category: 'character', count: characters, tint: tint('character') },
      { category: 'item', count: items, tint: tint('item') },
    ],
    quickAccess: [
      { category: 'location', tint: tint('location') },
      { category: 'faction', tint: tint('faction') },
    ],
  }
}

/** `9+` above the cap keeps the cell's width stable; zero stays `0` (the view mutes it). */
export function formatStripCount(count: number): string {
  return count > STRIP_COUNT_CAP ? `${STRIP_COUNT_CAP}+` : String(count)
}

/** The phone Browse chip's single signal across every category. */
export function aggregateTint(
  byCategory: ReadonlyMap<RowCategory, RecentlyClassified>,
): RecentlyClassified | undefined {
  let tint: RecentlyClassified | undefined
  for (const value of byCategory.values()) {
    if (value === 'fresh') return 'fresh'
    tint = 'fading'
  }
  return tint
}
