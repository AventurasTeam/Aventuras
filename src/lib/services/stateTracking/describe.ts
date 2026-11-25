import type { TrackedEntityType, WorldStateChangeRecord } from '#lib/types/index.ts'
import type { RunGap, RunRefusal } from './runs'

const NOUN: Record<TrackedEntityType, string> = {
  character: 'character',
  location: 'location',
  item: 'item',
  story_beat: 'quest',
  lorebook_entry: 'lorebook entry',
}

function nameIn(values: Record<string, unknown> | null): string | null {
  const name = values?.name ?? values?.title
  return typeof name === 'string' && name.length > 0 ? name : null
}

/** One line for a change, for the reader: "Character “Aria” was edited (relationship)". */
export function describeChange(
  record: WorldStateChangeRecord,
  nameOf: (type: TrackedEntityType, id: string) => string | null = () => null,
): string {
  const noun = NOUN[record.entityType]
  const name =
    nameIn(record.after) ?? nameIn(record.before) ?? nameOf(record.entityType, record.entityId)
  const subject = name ? `${noun[0].toUpperCase()}${noun.slice(1)} “${name}”` : `A ${noun}`
  switch (record.op) {
    case 'create':
      return `${subject} was added`
    case 'delete':
    case 'softDelete':
      return `${subject} was deleted`
    case 'update': {
      const fields = Object.keys(record.after ?? record.before ?? {})
      return fields.length > 0
        ? `${subject} was edited (${fields.join(', ')})`
        : `${subject} was edited`
    }
  }
}

/** Why a checkpoint cannot be created at a past entry, for the reader. */
export function refusalMessage(reason: RunRefusal): string {
  switch (reason) {
    case 'targetUntracked':
      return 'World state changes were not recorded for this entry.'
    case 'targetClassifierOnly':
      return 'This entry has an old world state record without the lorebook.'
    case 'untracked':
      return 'World state changes were not recorded for some later entries.'
    case 'interrupted':
      return 'State Tracking was off for a time after this entry.'
    case 'classifierOnly':
      return 'Some later entries have old world state records without the lorebook.'
    case 'noAnchor':
      return 'No full world state was saved after this entry.'
  }
}

/** One thing breaking the tracked sequence, for the reader. */
export function gapMessage(gap: RunGap, entryNumberOf: (entryId: string) => number | null): string {
  const entry = (entryId: string) => {
    const n = entryNumberOf(entryId)
    return n === null ? 'an entry on another branch' : `entry ${n}`
  }
  switch (gap.cause) {
    case 'untracked':
    case 'classifierOnly': {
      const from = entryNumberOf(gap.entryId)
      const through = gap.throughEntryId && entryNumberOf(gap.throughEntryId)
      if (from !== null && through) {
        return gap.cause === 'untracked'
          ? `World state changes were not recorded for entries ${from} to ${through}.`
          : `Entries ${from} to ${through} have old world state records without the lorebook.`
      }
      return gap.cause === 'untracked'
        ? `World state changes were not recorded for ${entry(gap.entryId)}.`
        : `${capitalize(entry(gap.entryId))} has an old world state record without the lorebook.`
    }
    case 'header':
      return gap.sinceEntryId === null
        ? `World state changes before ${entry(gap.entryId)} were not fully recorded.`
        : `State Tracking was off between ${entry(gap.sinceEntryId)} and ${entry(gap.entryId)}.`
    case 'break':
      return `Recording was interrupted after ${entry(gap.entryId)}.`
    case 'trackingOff':
      return 'State Tracking is off.'
    case 'enabledAfter':
      if (gap.enabledSince === null) return 'State Tracking has no start time.'
      return gap.sinceEntryId === null
        ? 'This branch only has old world state records without the lorebook.'
        : `State Tracking was off after ${entry(gap.sinceEntryId)}.`
  }
}

function capitalize(text: string): string {
  return text[0].toUpperCase() + text.slice(1)
}

/** A chapter whose lore a revert undoes, by entry numbers; `number` is null once it was deleted. */
export interface LoreChapter {
  number: number | null
  first: number
  last: number
}

/**
 * What a revert undoes besides the changes listed one by one, a line each: the classifier's
 * changes when it holds any, then the lore management of each chapter it reaches.
 */
export function revertLines(classifier: boolean, chapters: LoreChapter[]): string[] {
  const named = chapters.filter((c) => c.number !== null).sort((a, b) => a.number! - b.number!)
  const orphaned = chapters.filter((c) => c.number === null).map((c) => c.last)
  const lines: string[] = []
  if (classifier) lines.push('Classifier changes will be reverted.')
  if (named.length > 0) {
    lines.push(`Lore management changes of ${chaptersNamed(named)} will be reverted.`)
  }
  if (orphaned.length > 0) {
    const at =
      orphaned.length === 1 ? `entry ${orphaned[0]}` : `entries ${listOf(orphaned.map(String))}`
    const whose =
      orphaned.length === 1 ? 'whose chapter was deleted' : 'whose chapters were deleted'
    lines.push(`Lore management changes recorded at ${at}, ${whose}, will be reverted.`)
  }
  return lines
}

/** That the chapters a removal reaches are deleted with it, or null when it reaches none. */
export function deletedChaptersLine(chapters: LoreChapter[]): string | null {
  const named = chapters.filter((c) => c.number !== null).sort((a, b) => a.number! - b.number!)
  if (named.length === 0) return null
  const which = chaptersNamed(named)
  return `${capitalize(which)} will be deleted.`
}

/**
 * That the world-state snapshots at these entry numbers will be deleted, or null when none will.
 * Past checkpoints there are rebuilt from a later full state afterwards.
 */
export function deletedSnapshotsLine(entryNumbers: number[]): string | null {
  const numbers = [...new Set(entryNumbers)].sort((a, b) => a - b)
  if (numbers.length === 0) return null
  if (numbers.length === 1)
    return `The world-state snapshot at entry ${numbers[0]} will be deleted.`
  const where =
    numbers.length <= 4
      ? `at entries ${listOf(numbers.map(String))}`
      : `between entries ${numbers[0]} and ${numbers[numbers.length - 1]}`
  return `${numbers.length} world-state snapshots ${where} will be deleted.`
}

/** `chapter 4 (entries 31–45)`, `chapters 4–5 (…)` or `chapters 2 and 4 (…)`. */
function chaptersNamed(named: LoreChapter[]): string {
  const numbers = named.map((c) => c.number!)
  const consecutive = numbers.every((n, i) => i === 0 || n === numbers[i - 1] + 1)
  const which =
    numbers.length === 1
      ? `chapter ${numbers[0]}`
      : consecutive
        ? `chapters ${numbers[0]}–${numbers[numbers.length - 1]}`
        : `chapters ${listOf(numbers.map(String))}`
  const first = Math.min(...named.map((c) => c.first))
  const last = Math.max(...named.map((c) => c.last))
  return `${which} (entries ${first}–${last})`
}

function listOf(items: string[]): string {
  return items.length === 1
    ? items[0]
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** What removing entries also does: the chapters and snapshots it deletes, then what it reverts. */
export function removalLines(
  chapters: LoreChapter[],
  snapshots: number[],
  classifier: boolean,
  lore: LoreChapter[],
): string[] {
  const deleted = deletedChaptersLine(chapters)
  const gone = deletedSnapshotsLine(snapshots)
  return [...(deleted ? [deleted] : []), ...(gone ? [gone] : []), ...revertLines(classifier, lore)]
}
