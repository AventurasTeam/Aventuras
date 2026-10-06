import type { PipelineAction } from '@/lib/actions'
import type { Entity, EntityKind } from '@/lib/db'

import { namesakeKey, orphanedFlags, withFlagClears } from './collision-flags'

export type CollisionPair = readonly [Entity, Entity]

export const RENAME_ISSUE = { emptyName: 'empty-name', stillColliding: 'still-colliding' } as const
export type RenameIssue = (typeof RENAME_ISSUE)[keyof typeof RENAME_ISSUE]

/** Why a rename can't resolve the pair: a blank name, or names the namesake rule still pairs. */
export function renameIssue(
  kind: EntityKind,
  names: readonly [string, string],
): RenameIssue | null {
  const [a, b] = names.map((name) => name.trim())
  if (a === '' || b === '') return RENAME_ISSUE.emptyName
  if (namesakeKey({ kind, name: a }) === namesakeKey({ kind, name: b }))
    return RENAME_ISSUE.stillColliding
  return null
}

const flaggedIds = (pair: CollisionPair) =>
  pair.filter((row) => row.nameCollisionFlag === 1).map((row) => row.id)

/**
 * The renamed rows' name updates, with the flag cleared on each flagged row of the pair and on any
 * other row the rename leaves without a namesake. Throws on a `renameIssue`: callers check first.
 */
export function entityRenameActions(input: {
  branchId: string
  pair: CollisionPair
  /** The pair's names after the rename, in pair order; an unchanged one is its current name. */
  names: readonly [string, string]
  branchEntities: readonly Entity[]
}): PipelineAction[] {
  const { branchId, pair, names } = input
  const issue = renameIssue(pair[0].kind, names)
  if (issue != null) throw new Error(`entityRenameActions: ${issue}`)
  const renamed = new Map<string, string>()
  pair.forEach((row, index) => {
    const name = names[index].trim()
    if (name !== row.name.trim()) renamed.set(row.id, name)
  })
  const updates: PipelineAction[] = [...renamed].map(([id, name]) => ({
    kind: 'updateEntity',
    source: 'user_edit',
    payload: { branchId, id, patch: { name } },
  }))
  const orphans = orphanedFlags({ entities: input.branchEntities, renamed })
  return withFlagClears(updates, branchId, [...flaggedIds(pair), ...orphans])
}

/** Keep as distinct: the flag cleared on each flagged row of the pair, and nothing else. */
export function entityKeepActions(input: {
  branchId: string
  pair: CollisionPair
}): PipelineAction[] {
  return withFlagClears([], input.branchId, flaggedIds(input.pair))
}
