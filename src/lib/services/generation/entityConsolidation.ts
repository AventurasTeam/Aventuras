/**
 * The duplicate worklist the user works through, and what acting on it does.
 *
 * `services/duplicates` finds the groups; `mergeEntities` says what keeping one of them
 * means field by field; this puts the two together against the store and the database, so
 * the window is a view and not a second copy of the logic.
 *
 * Every decision is scoped to a branch, like the lore management lock: a branch has its
 * own resolved view of these records.
 */

import { story } from '$lib/stores/story.svelte'
import { database } from '$lib/services/database'
import { createLogger } from '$lib/log'
import {
  findEntityDuplicates,
  pairKeys,
  scopeToPool,
  type DuplicateEntity,
  type DuplicatePool,
  type EntityDuplicateGroup,
} from '$lib/services/duplicates'
import {
  applyMergePlan,
  planCharacterMerge,
  planEntryMerge,
  planItemMerge,
  planLocationMerge,
  type MergePlan,
} from './mergeEntities'
import type { Character, Entry, Item, Location } from '$lib/types'

const log = createLogger('EntityConsolidation')

/** Pools in the order the window shows them: where duplicates actually accumulate first. */
const POOLS: DuplicatePool[] = ['character', 'location', 'item', 'lorebook']

function currentScope(): { storyId: string; branchId: string | null } | null {
  const current = story.currentStory
  return current ? { storyId: current.id, branchId: current.currentBranchId } : null
}

/**
 * Every open group across both pools.
 *
 * Reads the dismissals from the database rather than caching them: the window is opened
 * rarely, the table is tiny, and a stale cache here means re-asking a question the user
 * has already answered — the exact failure the table exists to prevent.
 */
export async function findAllDuplicates(): Promise<EntityDuplicateGroup[]> {
  const scope = currentScope()
  if (!scope) return []

  const dismissed = await database.getKeptSeparate(scope.storyId, scope.branchId)

  return POOLS.flatMap((pool) =>
    findEntityDuplicates(pool, entitiesFor(pool), scopeToPool(dismissed, pool)),
  )
}

/**
 * Everything a pool needs to take part, in one place per pool.
 *
 * The four were written out four times across three `switch`es that had to agree on the
 * same pool in the same order — and the lorebook arm, the only one that differs, differed
 * silently in each of them.
 */
interface PoolOps<T extends { id: string; name: string }> {
  /** The live rows, already narrowed to what may be offered as a duplicate. */
  rows: () => T[]
  /** What the detector compares. World-state rows have no aliases or sub-kind. */
  candidate: (row: T) => DuplicateEntity
  plan: (primary: T, rows: T[]) => MergePlan
  /** Writes the merged values. `updates` is what `applyMergePlan` produced. */
  write: (id: string, updates: Record<string, unknown>) => Promise<void>
  remove: (id: string) => Promise<void>
}

const POOL_OPS = {
  character: {
    // The protagonist is excluded: `deleteCharacter` refuses them, so a group containing
    // one can only ever be half-resolved, and offering it is offering a dead end.
    rows: () => story.characters.filter((c) => c.relationship !== 'self'),
    candidate: (c) => ({ id: c.id, name: c.name }),
    plan: planCharacterMerge,
    write: (id, updates) => story.updateCharacter(id, updates as Partial<Character>),
    remove: (id) => story.deleteCharacter(id),
  } satisfies PoolOps<Character>,
  location: {
    rows: () => story.locations,
    candidate: (l) => ({ id: l.id, name: l.name }),
    plan: planLocationMerge,
    write: (id, updates) => story.updateLocation(id, updates as Partial<Location>),
    remove: (id) => story.deleteLocation(id),
  } satisfies PoolOps<Location>,
  item: {
    rows: () => story.items,
    candidate: (i) => ({ id: i.id, name: i.name }),
    plan: planItemMerge,
    write: (id, updates) => story.updateItem(id, updates as Partial<Item>),
    remove: (id) => story.deleteItem(id),
  } satisfies PoolOps<Item>,
  lorebook: {
    rows: () => story.lorebookEntries,
    candidate: (e) => ({ id: e.id, name: e.name, aliases: e.aliases, type: e.type }),
    plan: planEntryMerge,
    write: async (id, updates) => {
      // Keywords live under `injection`, which the plan flattens for the preview. Read the
      // rest of `injection` back so a merge does not reset the mode or the priority.
      const { keywords, ...rest } = updates as Partial<Entry> & { keywords?: string[] }
      const current = story.lorebookEntries.find((e) => e.id === id)
      await story.updateLorebookEntry(id, {
        ...rest,
        ...(current ? { injection: { ...current.injection, keywords: keywords ?? [] } } : {}),
      })
    },
    remove: (id) => story.deleteLorebookEntries([id]),
  } satisfies PoolOps<Entry>,
} as const

/** The pool's operations, with the row type erased — every caller works by id and name. */
function opsFor(pool: DuplicatePool): PoolOps<{ id: string; name: string }> {
  return POOL_OPS[pool] as unknown as PoolOps<{ id: string; name: string }>
}

function entitiesFor(pool: DuplicatePool): DuplicateEntity[] {
  const ops = opsFor(pool)
  return ops.rows().map(ops.candidate)
}

/**
 * What merging this group would write, for the user to look at before it happens.
 *
 * `primaryId` is their choice of which name survives, which is the only part a machine
 * cannot infer. Everything else the plan either fills in unambiguously or marks as a
 * conflict to settle — nothing is decided silently, because a merge deletes rows and
 * `deleteCharacter` is not undoable.
 */
export function buildMergePlan(group: EntityDuplicateGroup, primaryId: string): MergePlan | null {
  const ops = opsFor(group.pool)
  const ids = new Set(group.entities.map((e) => e.id))
  const rows = ops.rows().filter((r) => ids.has(r.id))
  const primary = rows.find((r) => r.id === primaryId)
  return primary ? ops.plan(primary, rows) : null
}

/**
 * Fold a group into one record, exactly as the plan says.
 *
 * The plan is the whole decision: this only writes it and removes what it absorbed.
 *
 * **Write first, then remove, and report a removal that failed.** The other order would
 * lose the absorbed rows if the write then failed, which is worse than a leftover
 * duplicate. Re-running after a partial failure is safe: the plan holds absolute values,
 * and the append path refuses text the result already carries. No transaction, because
 * store methods write the database and the reactive arrays together and a rollback would
 * undo only one of them.
 */
export async function mergeGroup(group: EntityDuplicateGroup, plan: MergePlan): Promise<void> {
  const others = group.entities.map((e) => e.id).filter((id) => id !== plan.primaryId)
  if (others.length === 0) return

  const ops = opsFor(group.pool)
  log('Merging group', { pool: group.pool, primaryId: plan.primaryId, absorbing: others.length })

  await ops.write(plan.primaryId, applyMergePlan(plan))

  const failed: string[] = []
  for (const id of others) {
    try {
      await ops.remove(id)
    } catch (error) {
      log('Absorbed record could not be removed', { pool: group.pool, id, error })
      failed.push(id)
    }
  }

  if (failed.length > 0) {
    throw new Error(
      `Merged into ${plan.primaryId}, but ${failed.length} absorbed ${group.pool} record(s) could not be removed (${failed.join(', ')}). They are still listed as duplicates.`,
    )
  }
}

/** Record that a group is genuinely distinct subjects, so it is not offered again. */
export async function keepSeparate(group: EntityDuplicateGroup): Promise<void> {
  const scope = currentScope()
  if (!scope) return
  const keys = pairKeys(group.entities.map((e) => e.name))
  log('Keeping group separate', { pool: group.pool, pairs: keys.length })
  await database.addKeptSeparate(scope.storyId, scope.branchId, group.pool, keys)
}

/** Forget every dismissal on this branch. */
export async function forgetKeptSeparate(): Promise<void> {
  const scope = currentScope()
  if (!scope) return
  await database.clearKeptSeparate(scope.storyId, scope.branchId)
}
