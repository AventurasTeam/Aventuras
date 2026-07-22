import { storySettingsTabOrder, type StorySettingsTabId } from './tabs'

export type SectionDirtyState = {
  id: string
  tab: StorySettingsTabId
  dirtyFields: readonly string[]
}

/**
 * The surface's dirty fields in rail order. One field, so "clean" and "which
 * fields" can never disagree — read `dirtyFields.length` for both.
 */
export type SaveSessionSnapshot = {
  readonly dirtyFields: readonly string[]
}

const CLEAN_SNAPSHOT: SaveSessionSnapshot = { dirtyFields: [] }

function sameFields(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((field, i) => field === b[i])
}

/** Returns a fresh snapshot per dirty call — derive it (useMemo), never store it in state. */
// Rail order drives the label order in the save bar, so the user reads dirty
// fields in the same sequence the tabs present them. Sections sharing a tab tie
// on order and fall back to id, so the sequence stays stable across mounts.
export function computeSnapshot(sections: readonly SectionDirtyState[]): SaveSessionSnapshot {
  const dirtyFields = [...sections]
    .sort(
      (a, b) =>
        storySettingsTabOrder(a.tab) - storySettingsTabOrder(b.tab) || a.id.localeCompare(b.id),
    )
    .flatMap((section) => section.dirtyFields)
  if (dirtyFields.length === 0) return CLEAN_SNAPSHOT
  return { dirtyFields }
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
  if (current.tab === next.tab && sameFields(current.dirtyFields, next.dirtyFields)) {
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
