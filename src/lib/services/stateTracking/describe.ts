import type { TrackedEntityType, WorldStateChangeRecord } from '#lib/types/index.ts'
import type { RunRefusal } from './runs'

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

/** One line for a change, for the reader: "Edited character “Aria” (relationship)". */
export function describeChange(
  record: WorldStateChangeRecord,
  nameOf: (type: TrackedEntityType, id: string) => string | null = () => null,
): string {
  const noun = NOUN[record.entityType]
  const name =
    nameIn(record.after) ?? nameIn(record.before) ?? nameOf(record.entityType, record.entityId)
  const subject = name ? `${noun} “${name}”` : `a ${noun}`
  switch (record.op) {
    case 'create':
      return `Added ${subject}`
    case 'delete':
    case 'softDelete':
      return `Deleted ${subject}`
    case 'update': {
      const fields = Object.keys(record.after ?? record.before ?? {})
      return fields.length > 0 ? `Edited ${subject} (${fields.join(', ')})` : `Edited ${subject}`
    }
  }
}

/** Why a checkpoint cannot be created at a past entry, for the reader. */
export function refusalMessage(reason: RunRefusal): string {
  switch (reason) {
    case 'untracked':
      return 'Part of the story after this entry was played without State Tracking, so its state cannot be rebuilt.'
    case 'interrupted':
      return 'State Tracking was interrupted after this entry, so changes may have been made without a record.'
    case 'classifierOnly':
      return 'The story after this entry was tracked before lorebook and manual changes were recorded, so the lorebook at this entry cannot be rebuilt.'
    case 'noAnchor':
      return 'There is no saved state after this entry to rebuild it from.'
  }
}
