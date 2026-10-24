import { and, eq } from 'drizzle-orm'

import type { CollisionReason, Entity, EntityState, NewEntity } from '@/lib/db'
import {
  branches,
  COLLISION_REASONS,
  emptyEntityState,
  entities,
  entityStateColumnSchema,
  entityStateSchemaForKind,
  entityWriteSchema,
  KIND_FIELDS,
  stories,
} from '@/lib/db'
import { entitiesStore } from '@/lib/stores'
import { parentIdOf, PLACE_REFUSAL } from '@/lib/world'

import { cascadedDelete } from '../delta/delete-cascade'
import { computeUndoPayload, deepEqual } from '../delta/delta-encoding'
import {
  register,
  noopRefusal,
  TARGET_NOT_FOUND,
  undefinedColumn,
  type ActionHandler,
  type HandlerOutcome,
} from '../delta/registry'
import type { DbCtx, DeltaSource } from '../types'
import { entityCascade } from './entity-cascade'
import { branchPlaces, parentChainRefusal } from './parent-chain-check'
import {
  appendEntityKeywordsHandler,
  placeLocationHandler,
  promoteStagedEntityHandler,
  raiseCollisionFlagHandler,
  renameEntityHandler,
  retireEntityHandler,
  returnFromRetirementHandler,
  setCharacterFactionHandler,
  setFactionStandingHandler,
  updateEntityConditionHandler,
  updateEntityInventoryHandler,
  updateEntityLocationTrackingHandler,
  updateEntityStackablesHandler,
  updateEntityVisualStateHandler,
  updateItemPositionHandler,
} from './state-patch-actions'

type EntityColumnPatch = Partial<{
  name: string
  description: string | null
  status: Entity['status']
  retiredReason: string | null
  injectionMode: Entity['injectionMode']
  tags: string[]
  keywords: string[]
  priority: number
  state: EntityState
}>

/** Clears a collision flag with its partner and reason, all three in one write. */
export type FlagClearPatch = {
  nameCollisionFlag: 0
  nameCollisionPartnerId: null
  nameCollisionReason: null
}

/**
 * Points a flagged row at another partner, leaving its flag as it is. The reason stays too unless
 * the patch carries the one that describes the new pairing (a merge taking over the loser's partner).
 */
export type FlagRepointPatch = {
  nameCollisionPartnerId: string
  nameCollisionReason?: CollisionReason
  nameCollisionFlag?: never
}

type NoFlagPatch = {
  nameCollisionFlag?: never
  nameCollisionPartnerId?: never
  nameCollisionReason?: never
}

// The classifier sets the flag at create; a user write only clears it or re-points the partner
// (data-model.md → Authorship contract). Omit a key to leave it: an explicit undefined is refused.
type EntityUpdatePatch = EntityColumnPatch & (NoFlagPatch | FlagClearPatch | FlagRepointPatch)

declare module '@/lib/actions/action-map' {
  interface PipelineActionMap {
    createEntity: { source: DeltaSource; payload: { entry: NewEntity } }
    updateEntity: {
      source: DeltaSource
      payload: { branchId: string; id: string; patch: EntityUpdatePatch }
    }
    deleteEntity: { source: DeltaSource; payload: { branchId: string; id: string } }
  }
}

// Delta-logged columns.
export const UPDATABLE = [
  'name',
  'description',
  'status',
  'retiredReason',
  'injectionMode',
  'tags',
  'keywords',
  'priority',
  'state',
  'nameCollisionFlag',
  'nameCollisionPartnerId',
  'nameCollisionReason',
] as const

const FLAG_COLUMNS = ['nameCollisionFlag', 'nameCollisionPartnerId', 'nameCollisionReason'] as const

function fullRow(entry: NewEntity): Entity {
  // Apply SQLite defaults so the inserted row and the store create-patch row are byte-identical.
  return {
    id: entry.id,
    branchId: entry.branchId,
    kind: entry.kind,
    name: entry.name,
    description: entry.description ?? null,
    status: entry.status,
    retiredReason: entry.retiredReason ?? null,
    injectionMode: entry.injectionMode,
    nameCollisionFlag: entry.nameCollisionFlag ?? 0,
    nameCollisionPartnerId: entry.nameCollisionPartnerId ?? null,
    nameCollisionReason: entry.nameCollisionReason ?? null,
    state: entry.state ?? emptyEntityState(entry.kind),
    tags: entry.tags ?? [],
    keywords: entry.keywords ?? [],
    priority: entry.priority ?? 0,
    // A new row has no vector by definition — default dirty. Clearing happens via a
    // same-batch stale-clear op once the embed lands, never via an explicit 0.
    embeddingStale: entry.embeddingStale ?? 1,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}

const SELF_PARTNER = 'an entity cannot be its own collision partner'

// edge-cases.md → Schema's CHECK, refused here rather than failing as SQL.
function flagTripleIssue(row: Entity): string | null {
  const partner = row.nameCollisionPartnerId
  const reason = row.nameCollisionReason
  if (row.nameCollisionFlag === 0)
    return partner == null && reason == null
      ? null
      : 'an unflagged entity has no collision partner or reason'
  if (row.nameCollisionFlag !== 1)
    return `nameCollisionFlag must be 0 or 1, got ${row.nameCollisionFlag}`
  if (partner == null || partner === '') return 'a flagged entity needs a collision partner'
  if (partner === row.id) return SELF_PARTNER
  if (reason == null || !COLLISION_REASONS.includes(reason))
    return `a flagged entity needs a collision reason, got ${String(reason)}`
  return null
}

// entityWriteSchema omits the flag columns, so its parse strips them instead of checking them.
function flagPatchIssue(patch: Record<string, unknown>, current: Entity): string | null {
  const named = FLAG_COLUMNS.filter((col) => col in patch)
  if (named.length === 0) return null
  const clears =
    named.length === FLAG_COLUMNS.length &&
    patch.nameCollisionFlag === 0 &&
    patch.nameCollisionPartnerId === null &&
    patch.nameCollisionReason === null
  if (clears) return null
  const reason = patch.nameCollisionReason
  const repoints =
    named.every((col) => col !== 'nameCollisionFlag') &&
    typeof patch.nameCollisionPartnerId === 'string' &&
    patch.nameCollisionPartnerId !== '' &&
    (!('nameCollisionReason' in patch) ||
      (typeof reason === 'string' && COLLISION_REASONS.some((r) => r === reason)))
  if (!repoints) return 'collision flag columns take only a clear or a partner re-point'
  if (patch.nameCollisionPartnerId === current.id) return SELF_PARTNER
  return current.nameCollisionFlag === 1 ? null : 'only a flagged entity has a partner to re-point'
}

// data-model.md → LocationState: the pre-commit walk. A create that isn't itself retired refuses a
// retired parent: no group revives one beside a new child, so pre-group state counts. An update
// can't be judged so (a merge revives a retired row while re-parenting), so its builders check it.
async function refuseParent(
  branchId: string,
  id: string,
  proposed: string | null,
  ctx: DbCtx,
  { refuseRetired }: { refuseRetired: boolean },
): Promise<HandlerOutcome | null> {
  if (proposed == null) return null
  const rows = await branchPlaces(ctx, branchId)
  const refused = parentChainRefusal(branchId, id, proposed, rows)
  if (refused !== null) return { status: 'rejected', reason: refused, code: refused }
  if (refuseRetired && rows.find((r) => r.id === proposed)?.status === 'retired')
    return {
      status: 'rejected',
      reason: PLACE_REFUSAL.retiredParent,
      code: PLACE_REFUSAL.retiredParent,
    }
  return null
}

const createHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'createEntity')
    throw new Error(`handler/kind mismatch: expected 'createEntity', got '${action.kind}'`)
  const { entry } = action.payload
  if (entry.branchId !== branchId)
    return {
      status: 'rejected',
      reason: `branch mismatch: delta ${branchId} vs entry ${entry.branchId}`,
    }
  const row = fullRow(entry)
  const scalars = entityWriteSchema.safeParse(row)
  if (!scalars.success)
    return { status: 'rejected', reason: `invalid entity: ${scalars.error.message}` }
  const flagIssue = flagTripleIssue(row)
  if (flagIssue != null) return { status: 'rejected', reason: `invalid entity: ${flagIssue}` }
  const parsed = entityStateSchemaForKind(row.kind).safeParse(row.state)
  if (!parsed.success)
    return { status: 'rejected', reason: `invalid ${row.kind} state: ${parsed.error.message}` }
  if (row.kind === 'location') {
    const refused = await refuseParent(branchId, row.id, parentIdOf(row), ctx, {
      refuseRetired: row.status !== 'retired',
    })
    if (refused) return refused
  }
  return {
    status: 'ok',
    targetTable: 'entities',
    targetId: row.id,
    op: 'create',
    undoPayload: null,
    ops: [ctx.db.insert(entities).values(row).toSQL()],
    patch: { op: 'create', id: row.id, row },
  }
}

const updateHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'updateEntity')
    throw new Error(`handler/kind mismatch: expected 'updateEntity', got '${action.kind}'`)
  const { branchId: bid, id, patch } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const [current] = await ctx.db
    .select()
    .from(entities)
    .where(and(eq(entities.branchId, bid), eq(entities.id, id)))
  if (!current)
    return {
      status: 'rejected',
      reason: `update target entities ${bid}:${id} not found`,
      code: TARGET_NOT_FOUND,
    }
  const blank = undefinedColumn(patch, UPDATABLE)
  if (blank != null)
    return { status: 'rejected', reason: `invalid entity patch: ${blank} is undefined` }

  const scalars = entityWriteSchema.partial().safeParse(patch)
  if (!scalars.success)
    return { status: 'rejected', reason: `invalid entity patch: ${scalars.error.message}` }
  const flagIssue = flagPatchIssue(patch, current)
  if (flagIssue != null) return { status: 'rejected', reason: `invalid entity patch: ${flagIssue}` }

  if (patch.state !== undefined) {
    const parsed = entityStateSchemaForKind(current.kind).safeParse(patch.state)
    if (!parsed.success)
      return {
        status: 'rejected',
        reason: `invalid ${current.kind} state: ${parsed.error.message}`,
      }
  }

  if (patch.state !== undefined && current.kind === 'location') {
    const proposed = parentIdOf({ state: patch.state })
    if (proposed !== parentIdOf(current)) {
      const refused = await refuseParent(bid, id, proposed, ctx, { refuseRetired: false })
      if (refused) return refused
    }
  }

  const named = UPDATABLE.filter((col) => col in patch)
  // No updatable column → Drizzle's .set({}) would throw "No values to set"; reject instead.
  if (named.length === 0)
    return {
      status: 'rejected',
      reason: `update patch for entities ${bid}:${id} has no updatable fields`,
    }

  // Unchanged columns are dropped, not recorded: user precedence reads an undo payload's
  // keys as the columns the user wrote (user-precedence.ts).
  const set: Record<string, unknown> = {}
  const undoPayload: Record<string, unknown> = {}
  for (const col of named) {
    if (col === 'state') {
      const prior = (current.state ?? emptyEntityState(current.kind)) as Record<string, unknown>
      const partial = computeUndoPayload(
        entityStateColumnSchema,
        prior,
        patch.state as Record<string, unknown>,
      )
      if (Object.keys(partial).length === 0) continue
      set.state = patch.state
      undoPayload.state = partial
    } else {
      const prior = current[col as keyof Entity]
      if (deepEqual(patch[col], prior)) continue
      set[col] = patch[col]
      undoPayload[col] = prior
    }
  }
  if (Object.keys(set).length === 0) return noopRefusal('no-op entity patch')

  // Only KIND_FIELDS is embedded — status/tags/state edits deliberately don't flip the flag.
  // The compare errs dirty on null-vs-'' (compositeText treats them alike): never a stale one.
  const [firstField, secondField] = KIND_FIELDS.entity
  if (
    (firstField in set && set[firstField] !== (current[firstField] ?? null)) ||
    (secondField in set && set[secondField] !== (current[secondField] ?? null))
  ) {
    set.embeddingStale = 1
  }

  return {
    status: 'ok',
    targetTable: 'entities',
    targetId: id,
    op: 'update',
    undoPayload,
    ops: [
      ctx.db
        .update(entities)
        .set(set)
        .where(and(eq(entities.branchId, bid), eq(entities.id, id)))
        .toSQL(),
    ],
    patch: { op: 'update', id, columns: set },
  }
}

export const ENTITY_DELETE_REJECTION = { leadEntity: 'lead-entity' } as const

async function isStoryLead(ctx: DbCtx, branchId: string, id: string): Promise<boolean> {
  const [owner] = await ctx.db
    .select({ definition: stories.definition })
    .from(branches)
    .innerJoin(stories, eq(stories.id, branches.storyId))
    .where(eq(branches.id, branchId))
  return owner?.definition?.leadEntityId === id
}

const deleteHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'deleteEntity')
    throw new Error(`handler/kind mismatch: expected 'deleteEntity', got '${action.kind}'`)
  const { branchId: bid, id } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const [current] = await ctx.db
    .select()
    .from(entities)
    .where(and(eq(entities.branchId, bid), eq(entities.id, id)))
  if (!current)
    return {
      status: 'rejected',
      reason: `delete target entities ${bid}:${id} not found`,
      code: TARGET_NOT_FOUND,
    }
  // Interim: lead isn't per-branch/delta-logged yet (M6) — deleting it would dangle the pointer.
  if (await isStoryLead(ctx, bid, id))
    return {
      status: 'rejected',
      reason: 'the story lead cannot be deleted',
      code: ENTITY_DELETE_REJECTION.leadEntity,
    }
  return cascadedDelete(ctx, entityCascade, {
    table: 'entities',
    row: current,
    deleteOp: ctx.db
      .delete(entities)
      .where(and(eq(entities.branchId, bid), eq(entities.id, id)))
      .toSQL(),
  })
}

export function registerEntities(): void {
  register({
    table: 'entities',
    descriptor: { table: entities, idCol: entities.id, branchCol: entities.branchId },
    columnSchemas: { state: entityStateColumnSchema },
    handlers: {
      createEntity: createHandler,
      updateEntity: updateHandler,
      deleteEntity: deleteHandler,
      updateEntityVisualState: updateEntityVisualStateHandler,
      updateEntityInventory: updateEntityInventoryHandler,
      updateEntityStackables: updateEntityStackablesHandler,
      updateItemPosition: updateItemPositionHandler,
      updateEntityCondition: updateEntityConditionHandler,
      updateEntityLocationTracking: updateEntityLocationTrackingHandler,
      promoteStagedEntity: promoteStagedEntityHandler,
      appendEntityKeywords: appendEntityKeywordsHandler,
      retireEntity: retireEntityHandler,
      setCharacterFaction: setCharacterFactionHandler,
      renameEntity: renameEntityHandler,
      raiseCollisionFlag: raiseCollisionFlagHandler,
      setFactionStanding: setFactionStandingHandler,
      returnFromRetirement: returnFromRetirementHandler,
      placeLocation: placeLocationHandler,
    },
    patcher: (branchId, p) => entitiesStore.patch(branchId, p),
    cascade: entityCascade,
  })
}
