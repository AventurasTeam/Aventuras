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
      return 'World state changes were not recorded for this entry, so its state is unknown.'
    case 'untracked':
      return 'World state changes were not recorded for some entries after this one, so its state cannot be rebuilt.'
    case 'interrupted':
      return 'World state recording was interrupted after this entry, so some changes may be missing.'
    case 'classifierOnly':
      return 'World state changes after this entry were recorded without lorebook and manual changes, so the lorebook at this entry cannot be rebuilt.'
    case 'noAnchor':
      return 'No full world state was saved after this entry to rebuild it from.'
  }
}

/** What breaks the tracked sequence, for the reader. */
export function gapMessage(
  gap: RunGap,
  entryNumberOf: (entryId: string) => number | null,
  time: (ms: number) => string,
): string {
  const at = (entryId: string) => {
    const n = entryNumberOf(entryId)
    return n === null ? 'an entry not on this branch' : `entry ${n}`
  }
  switch (gap.cause) {
    case 'untracked':
      return `World state changes were not recorded for ${at(gap.entryId)}.`
    case 'classifierOnly':
      return `World state changes for ${at(gap.entryId)} were recorded without lorebook and manual changes, so the lorebook cannot be rebuilt.`
    case 'header':
      return gap.since === null
        ? `World state changes were not recorded at some point before ${time(gap.at)}, when those of ${at(gap.entryId)} were.`
        : `World state changes were not recorded for a while between ${time(gap.since)} and ${time(gap.at)}, before those of ${at(gap.entryId)}.`
    case 'break':
      return `World state changes may not have been recorded after ${at(gap.entryId)}: the story was exported on ${time(gap.at)} from a device that could not vouch for them.`
    case 'trackingOff':
      return 'World state changes are not being recorded: State Tracking is off.'
    case 'enabledAfter': {
      const { lastProofAt, enabledSince } = gap
      if (enabledSince === null) {
        return 'World state changes were not recorded at some point: State Tracking has no recorded start time.'
      }
      return lastProofAt === null
        ? `World state changes were not recorded at some point before ${time(enabledSince)}, when State Tracking was last turned on.`
        : `World state changes were not recorded for a while between ${time(lastProofAt)} and ${time(enabledSince)}, while State Tracking was off.`
    }
    case 'lateChange':
      return `A world state change for ${at(gap.entryId)} was recorded on ${time(gap.at)}, after the full state it would be rebuilt from was saved on ${time(gap.anchorTakenAt)}.`
  }
}
