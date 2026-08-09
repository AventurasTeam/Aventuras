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

  return POOLS.flatMap((pool) => {
    const dismissedInPool = new Set(
      [...dismissed]
        .filter((key) => key.startsWith(`${pool}:`))
        .map((key) => key.slice(pool.length + 1)),
    )
    return findEntityDuplicates(pool, entitiesFor(pool), dismissedInPool)
  })
}

function entitiesFor(pool: DuplicatePool) {
  switch (pool) {
    case 'character':
      // The protagonist is excluded: `deleteCharacter` refuses them, so a group containing
      // one can only ever be half-resolved, and offering it is offering a dead end.
      return story.characters
        .filter((c) => c.relationship !== 'self')
        .map((c) => ({ id: c.id, name: c.name }))
    case 'location':
      return story.locations.map((l) => ({ id: l.id, name: l.name }))
    case 'item':
      return story.items.map((i) => ({ id: i.id, name: i.name }))
    case 'lorebook':
      return story.lorebookEntries.map((e) => ({
        id: e.id,
        name: e.name,
        aliases: e.aliases,
        type: e.type,
      }))
  }
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
  const ids = group.entities.map((e) => e.id)

  switch (group.pool) {
    case 'character': {
      const rows = story.characters.filter((c) => ids.includes(c.id))
      const primary = rows.find((c) => c.id === primaryId)
      return primary ? planCharacterMerge(primary, rows) : null
    }
    case 'location': {
      const rows = story.locations.filter((l) => ids.includes(l.id))
      const primary = rows.find((l) => l.id === primaryId)
      return primary ? planLocationMerge(primary, rows) : null
    }
    case 'item': {
      const rows = story.items.filter((i) => ids.includes(i.id))
      const primary = rows.find((i) => i.id === primaryId)
      return primary ? planItemMerge(primary, rows) : null
    }
    case 'lorebook': {
      const rows = story.lorebookEntries.filter((e) => ids.includes(e.id))
      const primary = rows.find((e) => e.id === primaryId)
      return primary ? planEntryMerge(primary, rows) : null
    }
  }
}

/**
 * Fold a group into one record, exactly as the plan says.
 *
 * The plan is the whole decision: this only writes it and removes what it absorbed.
 */
export async function mergeGroup(group: EntityDuplicateGroup, plan: MergePlan): Promise<void> {
  const ids = group.entities.map((e) => e.id)
  const others = ids.filter((id) => id !== plan.primaryId)
  if (others.length === 0) return

  const updates = applyMergePlan(plan)
  log('Merging group', { pool: group.pool, primaryId: plan.primaryId, absorbing: others.length })

  switch (group.pool) {
    case 'character':
      await story.updateCharacter(plan.primaryId, updates as Partial<Character>)
      for (const id of others) await story.deleteCharacter(id)
      break
    case 'location':
      await story.updateLocation(plan.primaryId, updates as Partial<Location>)
      for (const id of others) await story.deleteLocation(id)
      break
    case 'item':
      await story.updateItem(plan.primaryId, updates as Partial<Item>)
      for (const id of others) await story.deleteItem(id)
      break
    case 'lorebook': {
      const { keywords, ...rest } = updates as Partial<Entry> & { keywords?: string[] }
      const primary = story.lorebookEntries.find((e) => e.id === plan.primaryId)
      await story.updateLorebookEntry(plan.primaryId, {
        ...rest,
        // Keywords live under `injection`, which the plan flattens for the preview.
        ...(primary ? { injection: { ...primary.injection, keywords: keywords ?? [] } } : {}),
      })
      await story.deleteLorebookEntries(others)
      break
    }
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
