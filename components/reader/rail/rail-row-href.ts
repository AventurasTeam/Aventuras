import { plotHref } from '@/components/plot/plot-selection'
import { worldHref } from '@/components/world/world-selection'
import type { RailCategory } from '@/lib/reader-rail'

/** The owning panel with the row pre-selected (M4 C6). */
export function railRowHref(branchId: string, category: RailCategory, id: string): string {
  if (category === 'thread' || category === 'happening') {
    return plotHref(branchId, { kind: category, id })
  }
  return worldHref(branchId, { category, id })
}
