export type SectionDirtyState = {
  id: string
  order: number
  dirtyFields: readonly string[]
}

export type SaveSessionSnapshot = {
  isDirty: boolean
  dirtyFields: readonly string[]
  dirtyCount: number
}

export const CLEAN_SNAPSHOT: SaveSessionSnapshot = {
  isDirty: false,
  dirtyFields: [],
  dirtyCount: 0,
}

function sameFields(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((field, i) => field === b[i])
}

// Rail order drives the label order in the save bar, so the user reads dirty
// fields in the same sequence the tabs present them.
export function computeSnapshot(sections: readonly SectionDirtyState[]): SaveSessionSnapshot {
  const dirtyFields = [...sections]
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .flatMap((section) => section.dirtyFields)
  if (dirtyFields.length === 0) return CLEAN_SNAPSHOT
  return { isDirty: true, dirtyFields, dirtyCount: dirtyFields.length }
}

// Returns the SAME array reference when nothing changed, so the provider's
// setState is a no-op and a section republishing an unchanged list can't loop.
export function upsertSection(
  sections: readonly SectionDirtyState[],
  next: SectionDirtyState,
): readonly SectionDirtyState[] {
  const index = sections.findIndex((s) => s.id === next.id)
  if (index === -1) return [...sections, next]
  const current = sections[index]
  if (current.order === next.order && sameFields(current.dirtyFields, next.dirtyFields)) {
    return sections
  }
  const copy = [...sections]
  copy[index] = next
  return copy
}

export function removeSection(
  sections: readonly SectionDirtyState[],
  id: string,
): readonly SectionDirtyState[] {
  if (!sections.some((s) => s.id === id)) return sections
  return sections.filter((s) => s.id !== id)
}
