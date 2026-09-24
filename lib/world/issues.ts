/** Draft-schema issue messages; each is a `world:validation.*` key the panes translate. */
export const WORLD_ISSUE = {
  nameRequired: 'nameRequired',
  tooLong: 'tooLong',
  priorityRange: 'priorityRange',
  stackableKeyRequired: 'stackableKeyRequired',
  stackableCount: 'stackableCount',
  duplicateStackable: 'duplicateStackable',
  characterRequired: 'characterRequired',
  relationshipPovRequired: 'relationshipPovRequired',
  duplicateRelationship: 'duplicateRelationship',
  parentCycle: 'parentCycle',
} as const

export type WorldIssue = (typeof WORLD_ISSUE)[keyof typeof WORLD_ISSUE]

const ISSUES: readonly string[] = Object.values(WORLD_ISSUE)

export function isWorldIssue(message: string): message is WorldIssue {
  return ISSUES.includes(message)
}
