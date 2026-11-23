import { entriesStore } from '@/lib/stores'

/** The highest-position entry the working set holds for `branchId`, or null when it holds none. */
export function useBranchTailId(branchId: string | null): string | null {
  return entriesStore.useEntries(branchId, (m) => {
    let last: string | null = null
    let position = -1
    for (const e of m.values()) {
      if (e.position > position) {
        position = e.position
        last = e.id
      }
    }
    return last
  })
}
