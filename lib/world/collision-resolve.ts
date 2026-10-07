import type { PipelineAction } from '@/lib/actions'
import type { Entity, EntityKind } from '@/lib/db'

import { namesakeKey, orphanedFlags, withFlagClears } from './collision-flags'
import type { CollisionPair } from './collision-pair'

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

/** A row's name after a rename. */
export type EntityRename = { id: string; name: string }

export type EntityRenamePlan = { actions: PipelineAction[] } | { issue: RenameIssue }

/**
 * The renamed rows' name updates, with the flag cleared on each flagged row of the pair and on any
 * other row the rename leaves without a namesake; or the `renameIssue` that refuses it.
 */
export function entityRenameActions(input: {
  branchId: string
  pair: CollisionPair
  /** Matched to the pair by id; a pair row with no entry keeps its name. */
  renames: readonly EntityRename[]
  /** The branch's entities before the write, the pair among them: namesakes are counted from it. */
  branchEntities: readonly Entity[]
}): EntityRenamePlan {
  const { branchId, pair } = input
  const nameOf = (row: Entity) =>
    input.renames.find((rename) => rename.id === row.id)?.name ?? row.name
  const issue = renameIssue(pair[0].kind, [nameOf(pair[0]), nameOf(pair[1])])
  if (issue != null) return { issue }
  const renamed = new Map<string, string>()
  for (const row of pair) {
    const name = nameOf(row).trim()
    if (name !== row.name.trim()) renamed.set(row.id, name)
  }
  const updates: PipelineAction[] = [...renamed].map(([id, name]) => ({
    kind: 'updateEntity',
    source: 'user_edit',
    payload: { branchId, id, patch: { name } },
  }))
  const orphans = orphanedFlags({ entities: input.branchEntities, renamed })
  return { actions: withFlagClears(updates, branchId, [...flaggedIds(pair), ...orphans]) }
}

/** Keep as distinct: the flag cleared on each flagged row of the pair, and nothing else. */
export function entityKeepActions(input: {
  branchId: string
  pair: CollisionPair
}): PipelineAction[] {
  return withFlagClears([], input.branchId, flaggedIds(input.pair))
}
