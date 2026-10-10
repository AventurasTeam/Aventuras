import { and, eq } from 'drizzle-orm'

import type { Entity, EntityState, LocationState, NewEntity } from '@/lib/db'
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
import { logger } from '@/lib/diagnostics'
import { entitiesStore } from '@/lib/stores'
import { checkParentChain, PARENT_CHAIN_BROKEN, PARENT_CYCLE, parentOfLocations } from '@/lib/world'

import { cascadedDelete } from '../delta/delete-cascade'
import { computeUndoPayload, deepEqual } from '../delta/delta-encoding'
import {
  register,
  TARGET_NOT_FOUND,
  undefinedColumn,
  type ActionHandler,
  type HandlerOutcome,
} from '../delta/registry'
import type { DbCtx, DeltaSource } from '../types'
import { entityCascade } from './entity-cascade'
import {
  appendEntityKeywordsHandler,
  promoteStagedEntityHandler,
  retireEntityHandler,
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

/** Points a flagged row at another partner, leaving its flag and reason as they are. */
export type FlagRepointPatch = {
  nameCollisionPartnerId: string
  nameCollisionFlag?: never
  nameCollisionReason?: never
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
  const repoints =
    named.length === 1 &&
    typeof patch.nameCollisionPartnerId === 'string' &&
    patch.nameCollisionPartnerId !== ''
  if (!repoints) return 'collision flag columns take only a clear or a partner re-point'
  return current.nameCollisionFlag === 1 ? null : 'only a flagged entity has a partner to re-point'
}

// data-model.md → LocationState: the pre-commit walk, on every entity-handler write.
async function refuseParentCycle(
  branchId: string,
  id: string,
  proposed: string | null,
  ctx: DbCtx,
): Promise<HandlerOutcome | null> {
  if (proposed == null) return null
  const rows = await ctx.db
    .select({ id: entities.id, kind: entities.kind, state: entities.state })
    .from(entities)
    .where(and(eq(entities.branchId, branchId), eq(entities.kind, 'location')))
  const check = checkParentChain(id, proposed, parentOfLocations(rows))
  if (check === 'ok') return null
  if (check === 'cycle') return { status: 'rejected', reason: PARENT_CYCLE, code: PARENT_CYCLE }
  logger.error('action_layer.parent_chain_cap_hit', { branchId, id, parentId: proposed })
  return { status: 'rejected', reason: PARENT_CHAIN_BROKEN, code: PARENT_CHAIN_BROKEN }
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
    const refused = await refuseParentCycle(
      branchId,
      row.id,
      (row.state as LocationState).parent_location_id,
      ctx,
    )
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
    const proposed = (patch.state as LocationState).parent_location_id
    const prior = (current.state as LocationState | null)?.parent_location_id ?? null
    if (proposed !== prior) {
      const refused = await refuseParentCycle(bid, id, proposed, ctx)
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
  if (Object.keys(set).length === 0)
    return { status: 'rejected', reason: 'no-op entity patch', code: 'noop' }

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
      updateEntityLocationTracking: updateEntityLocationTrackingHandler,
      promoteStagedEntity: promoteStagedEntityHandler,
      appendEntityKeywords: appendEntityKeywordsHandler,
      retireEntity: retireEntityHandler,
    },
    patcher: (branchId, p) => entitiesStore.patch(branchId, p),
    cascade: entityCascade,
  })
}
