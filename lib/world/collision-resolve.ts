import type { PipelineAction } from '@/lib/actions'
import type { Entity } from '@/lib/db'

import { brokenFlags, pairFlagsToClear, withFlagClears } from './collision-flags'
import type { CollisionPair } from './collision-pair'
import { nameBasis, type NamesakeSide } from './namesakes'

export const RENAME_ISSUE = {
  emptyName: 'empty-name',
  unchanged: 'unchanged',
  stillColliding: 'still-colliding',
} as const
export type RenameIssue = (typeof RENAME_ISSUE)[keyof typeof RENAME_ISSUE]

/**
 * Why a rename can't resolve the pair (world.md → Rename): a blank name, no name changed, or names
 * that still match by name. Keywords don't count.
 */
export function renameIssue(
  original: readonly [string, string],
  names: readonly [string, string],
): RenameIssue | null {
  const [a, b] = names.map((name) => name.trim())
  if (a === '' || b === '') return RENAME_ISSUE.emptyName
  if (a === original[0].trim() && b === original[1].trim()) return RENAME_ISSUE.unchanged
  if (nameBasis(a, b) != null) return RENAME_ISSUE.stillColliding
  return null
}

/** A row's name after a rename. */
export type EntityRename = { id: string; name: string }

export type EntityRenamePlan = { actions: PipelineAction[] } | { issue: RenameIssue }

/**
 * The renamed rows' name updates, with the flag cleared on each pair row whose partner is the other
 * row or gone, and on any row the rename leaves no longer its partner's namesake; or the
 * `renameIssue` that refuses it.
 */
export function entityRenameActions(input: {
  branchId: string
  pair: CollisionPair
  /** Matched to the pair by id; a pair row with no entry keeps its name. */
  renames: readonly EntityRename[]
  /** The branch's entities before the write, the pair among them. */
  branchEntities: readonly Entity[]
}): EntityRenamePlan {
  const { branchId, pair, branchEntities } = input
  const nameOf = (row: Entity) =>
    input.renames.find((rename) => rename.id === row.id)?.name ?? row.name
  const issue = renameIssue([pair[0].name, pair[1].name], [nameOf(pair[0]), nameOf(pair[1])])
  if (issue != null) return { issue }
  const after = new Map<string, NamesakeSide>()
  const updates: PipelineAction[] = []
  for (const row of pair) {
    const name = nameOf(row).trim()
    if (name === row.name.trim()) continue
    after.set(row.id, { name, keywords: row.keywords })
    updates.push({
      kind: 'updateEntity',
      source: 'user_edit',
      payload: { branchId, id: row.id, patch: { name } },
    })
  }
  const clears = [
    ...pairFlagsToClear(pair, branchEntities),
    ...brokenFlags({ entities: branchEntities, after }),
  ]
  return { actions: withFlagClears(updates, branchId, clears) }
}

/** Keep as distinct: `pairFlagsToClear`'s clears, and nothing else. */
export function entityKeepActions(input: {
  branchId: string
  pair: CollisionPair
  /** The branch's entities: a pair row whose partner isn't among them is cleared too. */
  branchEntities: readonly Entity[]
}): PipelineAction[] {
  return withFlagClears([], input.branchId, pairFlagsToClear(input.pair, input.branchEntities))
}
