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
      return 'This entry has an old record without the lorebook.'
    case 'untracked':
      return 'World state changes were not recorded for some later entries.'
    case 'interrupted':
      return 'State Tracking was off for a time after this entry.'
    case 'classifierOnly':
      return 'Some later entries have old records without the lorebook.'
    case 'noAnchor':
      return 'No full world state was saved after this entry.'
  }
}

/** What breaks the tracked sequence, for the reader. */
export function gapMessage(gap: RunGap, entryNumberOf: (entryId: string) => number | null): string {
  const entry = (entryId: string) => {
    const n = entryNumberOf(entryId)
    return n === null ? 'an entry on another branch' : `entry ${n}`
  }
  switch (gap.cause) {
    case 'untracked':
      return `World state changes were not recorded for ${entry(gap.entryId)}.`
    case 'classifierOnly':
      return `${capitalize(entry(gap.entryId))} has an old record without the lorebook.`
    case 'header':
      return gap.sinceEntryId === null
        ? `World state changes before ${entry(gap.entryId)} were not fully recorded.`
        : `State Tracking was off between ${entry(gap.sinceEntryId)} and ${entry(gap.entryId)}.`
    case 'break':
      return `State Tracking was off after ${entry(gap.entryId)}.`
    case 'trackingOff':
      return 'State Tracking is off.'
    case 'enabledAfter':
      if (gap.enabledSince === null) return 'State Tracking has no start time.'
      return gap.sinceEntryId === null
        ? 'This branch only has old records without the lorebook.'
        : `State Tracking was off after ${entry(gap.sinceEntryId)}.`
  }
}

function capitalize(text: string): string {
  return text[0].toUpperCase() + text.slice(1)
}
