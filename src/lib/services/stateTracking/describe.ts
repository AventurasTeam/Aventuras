import type { TrackedEntityType, WorldStateChangeRecord } from '#lib/types/index.ts'

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
