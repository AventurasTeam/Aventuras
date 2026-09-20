import { storySettingsTabOrder, type StorySettingsTabId } from './tabs'

/** A definitional field the save-time confirmation lists (story-settings.md → Flagged fields). */
export type FlaggedField = { key: string; label: string; consequence: string }

export type SectionDirtyState = {
  id: string
  tab: StorySettingsTabId
  dirtyFields: readonly string[]
  /** Non-null when the section is dirty but its draft cannot be written. */
  invalidReason?: string
  /** The flagged fields among this section's dirty ones. */
  flaggedFields?: readonly FlaggedField[]
}

/**
 * The surface's dirty fields in rail order, plus the reason a save would be
 * refused. Clean is `dirtyFields.length === 0` — the one field, so "clean"
 * and "which fields" can never disagree.
 */
export type SaveSessionSnapshot = {
  readonly dirtyFields: readonly string[]
  /** First dirty-and-invalid section's reason, in rail order. */
  readonly invalidReason?: string
  /** Which section `invalidReason` came from. Logged instead of the translated copy. */
  readonly invalidSectionId?: string
  /** That section's tab, so the bar can say where the problem is. */
  readonly invalidTab?: StorySettingsTabId
  /** Dirty flagged fields across every section, in rail order. Empty when none. */
  readonly flaggedFields: readonly FlaggedField[]
}

const CLEAN_SNAPSHOT: SaveSessionSnapshot = { dirtyFields: [], flaggedFields: [] }

function sameFields(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((field, i) => field === b[i])
}

function sameFlagged(
  a: readonly FlaggedField[] | undefined,
  b: readonly FlaggedField[] | undefined,
): boolean {
  const left = a ?? []
  const right = b ?? []
  return (
    left.length === right.length &&
    left.every(
      (field, i) =>
        field.key === right[i]?.key &&
        field.label === right[i]?.label &&
        field.consequence === right[i]?.consequence,
    )
  )
}

/** Returns a fresh snapshot per dirty call — derive it (useMemo), never store it in state. */
// Rail order drives the label order in the save bar, so the user reads dirty
// fields in the same sequence the tabs present them. Sections sharing a tab tie
// on order and fall back to id, so the sequence stays stable across mounts.
export function computeSnapshot(sections: readonly SectionDirtyState[]): SaveSessionSnapshot {
  const ordered = [...sections].sort(
    (a, b) =>
      storySettingsTabOrder(a.tab) - storySettingsTabOrder(b.tab) || a.id.localeCompare(b.id),
  )
  const dirty = ordered.filter((section) => section.dirtyFields.length > 0)
  const dirtyFields = dirty.flatMap((section) => section.dirtyFields)
  if (dirtyFields.length === 0) return CLEAN_SNAPSHOT
  const flaggedFields = dirty.flatMap((section) => section.flaggedFields ?? [])
  // Gated on the section being dirty: the save skips clean sections entirely,
  // so an invalid draft the user never touched must not refuse the write.
  const invalid = dirty.find((section) => section.invalidReason != null)
  if (invalid?.invalidReason == null) return { dirtyFields, flaggedFields }
  return {
    dirtyFields,
    flaggedFields,
    invalidReason: invalid.invalidReason,
    invalidSectionId: invalid.id,
    invalidTab: invalid.tab,
  }
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
  if (
    current.tab === next.tab &&
    current.invalidReason === next.invalidReason &&
    sameFields(current.dirtyFields, next.dirtyFields) &&
    sameFlagged(current.flaggedFields, next.flaggedFields)
  ) {
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

// Deeper than any `StorySettings` branch. `packVariables` is an open record, so
// the floor has to be a depth cap rather than the schema — anything past it
// reads as "changed", which only costs a stale save bar.
const DRAFT_DEPTH_LIMIT = 12

/**
 * Point-in-time copy of a section's draft, for comparing against a later read.
 * Copied rather than held by reference: `getPatch` may hand back the section's
 * own draft object, and a later edit to it would rewrite the thing we're
 * comparing against.
 */
export function cloneDraft(value: unknown, depth = 0): unknown {
  if (depth >= DRAFT_DEPTH_LIMIT || typeof value !== 'object' || value === null) return value
  if (Array.isArray(value)) return value.map((item) => cloneDraft(item, depth + 1))
  const copy: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    copy[key] = cloneDraft((value as Record<string, unknown>)[key], depth + 1)
  }
  return copy
}

/**
 * Whether two reads of a section's draft are the same edit. Compares key *presence*, so
 * `{ k: undefined }` and `{}` differ. Don't swap in `JSON.stringify` equality, which drops
 * `undefined`-valued keys: it agrees today only because `saveStorySettingsSession` strips them
 * the same way, and nothing enforces that the two modules keep agreeing on that.
 */
export function sameDraft(a: unknown, b: unknown, depth = 0): boolean {
  // Only reached by a cycle or a draft deeper than the cap; both fall to
  // "changed", which skips a reset rather than discarding an edit.
  if (depth >= DRAFT_DEPTH_LIMIT) return false
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const aKeys = Object.keys(a)
  if (aKeys.length !== Object.keys(b).length) return false
  return aKeys.every(
    (key) =>
      Object.hasOwn(b, key) &&
      sameDraft(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        depth + 1,
      ),
  )
}
