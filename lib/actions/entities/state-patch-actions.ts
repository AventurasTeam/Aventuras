import { and, eq, or } from 'drizzle-orm'

import {
  emptyEntityState,
  entities,
  entityStateColumnSchema,
  type CharacterState,
  type CollisionReason,
  type Delta,
  type Entity,
  type EntityState,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { newTerms, normalizeTerm } from '@/lib/keyword-terms'
import { boundStateText } from '@/lib/piggyback'
import { entitiesStore } from '@/lib/stores'
import {
  brokenFlags,
  characterFactionId,
  flagStillHolds,
  moveHidesStory,
  nameBasis,
  namesakeBasis,
  nameHolders,
  pairSideOf,
  parentOfLocations,
  PLACE_REFUSAL,
  placementOf,
  realPlacementOf,
  samePlacement,
  stateOf,
  stillPaired,
  withPlacement,
} from '@/lib/world'

import { computeUndoPayload } from '../delta/delta-encoding'
import {
  keywordPairsFlagReason,
  keywordUserAddedReason,
  planKeywordEdit,
  priorTerms,
} from '../delta/keyword-authors'
import {
  noopRefusal,
  createdKey,
  type ActionHandler,
  type GroupScope,
  type HandlerCtx,
  type HandlerOutcome,
} from '../delta/registry'
import {
  USER_EDITED_SINCE_PROSE,
  userEditsSince,
  userEditsSinceProse,
  wroteField,
} from '../delta/user-precedence'
import type { DbCtx, DeltaSource, ProseEntryId } from '../types'
import { branchPlaces, parentChainRefusal } from './parent-chain-check'
import { loadStoryPlace } from '../story-entries/story-place'

declare module '@/lib/actions/action-map' {
  interface PipelineActionMap {
    updateEntityVisualState: {
      source: DeltaSource
      payload: { branchId: string; id: string; visual: Partial<CharacterState['visual']> }
    }
    updateEntityInventory: {
      source: DeltaSource
      payload: {
        branchId: string
        id: string
        equipped_items?: string[]
        inventory?: string[]
      }
    }
    updateEntityStackables: {
      source: DeltaSource
      payload: { branchId: string; id: string; stackables: Record<string, number> }
    }
    updateItemPosition: {
      source: DeltaSource
      payload: { branchId: string; id: string; atLocationId: string | null }
    }
    updateEntityCondition: {
      source: DeltaSource
      payload: { branchId: string; id: string; condition: string }
    }
    updateEntityLocationTracking: {
      source: DeltaSource
      payload: {
        branchId: string
        id: string
        currentLocationId?: string | null
        lastSeenAt?: { entryId: string; locationId: string | null; worldTime: number } | null
      }
    }
    promoteStagedEntity: {
      source: DeltaSource
      payload: { branchId: string; id: string; proseEntryId: ProseEntryId }
    }
    appendEntityKeywords: {
      source: DeltaSource
      payload: { branchId: string; id: string; keywords: string[]; proseEntryId: ProseEntryId }
    }
    setEntityKeywords: {
      source: DeltaSource
      payload: {
        branchId: string
        id: string
        add: string[]
        remove: string[]
        proseEntryId: ProseEntryId
      }
    }
    retireEntity: {
      source: DeltaSource
      payload: {
        branchId: string
        id: string
        retiredReason: string | null
        proseEntryId: ProseEntryId
      }
    }
    setCharacterFaction: {
      source: DeltaSource
      payload: {
        branchId: string
        id: string
        /** Null clears the membership. */
        factionId: string | null
        proseEntryId: ProseEntryId
      }
    }
    renameEntity: {
      source: DeltaSource
      payload: { branchId: string; id: string; name: string; proseEntryId: ProseEntryId }
    }
    raiseCollisionFlag: {
      source: DeltaSource
      payload: {
        branchId: string
        id: string
        partnerId: string
        reason: CollisionReason
        proseEntryId: ProseEntryId
      }
    }
    setFactionStanding: {
      source: DeltaSource
      payload: { branchId: string; id: string; standing: string; proseEntryId: ProseEntryId }
    }
    returnFromRetirement: {
      source: DeltaSource
      payload: { branchId: string; id: string; proseEntryId: ProseEntryId }
    }
    placeLocation: {
      source: DeltaSource
      payload: {
        branchId: string
        id: string
        /** `top` only for an unplaced place (data-model.md → Authorship contract). */
        placement: { kind: 'under'; parentId: string } | { kind: 'top' }
        /** Null skips user precedence: the per-turn writer's prose is always newer. */
        proseEntryId: ProseEntryId
      }
    }
  }
}

async function loadCurrent(branchId: string, id: string, ctx: DbCtx): Promise<Entity | undefined> {
  const [current] = await ctx.db
    .select()
    .from(entities)
    .where(and(eq(entities.branchId, branchId), eq(entities.id, id)))
  return current
}

// By wroteField's groups, so a write yields to a user edit as its reversal would.
async function userWroteSinceProse(
  ctx: DbCtx,
  branchId: string,
  id: string,
  proseEntryId: ProseEntryId,
  column: string,
  path: readonly string[] = [],
): Promise<boolean> {
  if (proseEntryId === null) return false
  const edits = await userEditsSinceProse(ctx, branchId, 'entities', id, proseEntryId)
  return wroteField(edits, 'entities', column, path)
}

function buildStatePatchOutcome(
  branchId: string,
  id: string,
  current: Entity,
  topLevelPatch: Record<string, unknown>,
  ctx: DbCtx,
) {
  const mergedState: Record<string, unknown> = { ...priorState(current) }
  for (const [key, value] of Object.entries(topLevelPatch)) {
    if (key === 'visual' && typeof value === 'object' && value !== null) {
      mergedState.visual = {
        ...(mergedState.visual as Record<string, unknown> | undefined),
        ...value,
      }
    } else {
      mergedState[key] = value
    }
  }
  return stateWriteOutcome(branchId, id, current, mergedState, ctx)
}

// A null column reads as the empty state, as updateEntity's does.
function priorState(current: Entity): Record<string, unknown> {
  return (current.state ?? emptyEntityState(current.kind)) as Record<string, unknown>
}

/** Writes `next` as the row's whole state: a key `next` lacks is gone from the row. */
function stateWriteOutcome(
  branchId: string,
  id: string,
  current: Entity,
  next: Record<string, unknown>,
  ctx: DbCtx,
): HandlerOutcome {
  const undoPayload = {
    state: computeUndoPayload(entityStateColumnSchema, priorState(current), next),
  }
  if (Object.keys(undoPayload.state).length === 0) {
    // 'noop', not a plain rejection: a model restating an entity's current state
    // is well-formed and merely redundant, and an unmarked rejection reverses the
    // user's whole turn (orchestrator handleEvent).
    return noopRefusal(`no-op state patch for entities ${branchId}:${id}`, 'restated')
  }
  return columnsWriteOutcome(branchId, id, { state: next as EntityState }, undoPayload, ctx)
}

function columnsWriteOutcome(
  branchId: string,
  id: string,
  columns: Partial<Entity>,
  undoPayload: Record<string, unknown>,
  ctx: DbCtx,
): HandlerOutcome {
  return {
    status: 'ok',
    targetTable: 'entities',
    targetId: id,
    op: 'update',
    undoPayload,
    ops: [
      ctx.db
        .update(entities)
        .set(columns)
        .where(and(eq(entities.branchId, branchId), eq(entities.id, id)))
        .toSQL(),
    ],
    patch: { op: 'update', id, columns },
  }
}

// buildStatePatchOutcome merges without parsing, and these fields belong to characters only.
function refuseNonCharacter(kind: string, current: Entity): HandlerOutcome | null {
  if (current.kind === 'character') return null
  return {
    status: 'rejected',
    reason: `${kind} target ${current.branchId}:${current.id} is not a character`,
  }
}

export const updateEntityVisualStateHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'updateEntityVisualState')
    throw new Error(
      `handler/kind mismatch: expected 'updateEntityVisualState', got '${action.kind}'`,
    )
  const { branchId: bid, id, visual } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current)
    return { status: 'rejected', reason: `update target entities ${bid}:${id} not found` }
  const wrongKind = refuseNonCharacter(action.kind, current)
  if (wrongKind) return wrongKind
  return buildStatePatchOutcome(bid, id, current, { visual }, ctx)
}

export const updateEntityInventoryHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'updateEntityInventory')
    throw new Error(`handler/kind mismatch: expected 'updateEntityInventory', got '${action.kind}'`)
  const { branchId: bid, id, equipped_items, inventory } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current)
    return { status: 'rejected', reason: `update target entities ${bid}:${id} not found` }
  const wrongKind = refuseNonCharacter(action.kind, current)
  if (wrongKind) return wrongKind
  const patch: Record<string, unknown> = {}
  if (equipped_items !== undefined) patch.equipped_items = equipped_items
  if (inventory !== undefined) patch.inventory = inventory
  if (Object.keys(patch).length === 0)
    return {
      status: 'rejected',
      reason: `updateEntityInventory payload for ${bid}:${id} touches no field`,
    }
  return buildStatePatchOutcome(bid, id, current, patch, ctx)
}

export const updateEntityStackablesHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'updateEntityStackables')
    throw new Error(
      `handler/kind mismatch: expected 'updateEntityStackables', got '${action.kind}'`,
    )
  const { branchId: bid, id, stackables } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current)
    return { status: 'rejected', reason: `update target entities ${bid}:${id} not found` }
  const wrongKind = refuseNonCharacter(action.kind, current)
  if (wrongKind) return wrongKind
  return buildStatePatchOutcome(bid, id, current, { stackables }, ctx)
}

export const updateItemPositionHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'updateItemPosition')
    throw new Error(`handler/kind mismatch: expected 'updateItemPosition', got '${action.kind}'`)
  const { branchId: bid, id, atLocationId } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current)
    return { status: 'rejected', reason: `update target entities ${bid}:${id} not found` }
  if (current.kind !== 'item')
    return { status: 'rejected', reason: `updateItemPosition target ${bid}:${id} is not an item` }
  return buildStatePatchOutcome(bid, id, current, { at_location_id: atLocationId }, ctx)
}

/**
 * A place's or item's condition, replaced whole and bounded as a visual value is. Checks no
 * precedence: the per-turn writer's prose is always newer than a user edit (cadence.md).
 */
export const updateEntityConditionHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'updateEntityCondition')
    throw new Error(`handler/kind mismatch: expected 'updateEntityCondition', got '${action.kind}'`)
  const { branchId: bid, id, condition } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current) return noopRefusal(`condition target entities ${bid}:${id} not found`, 'gone')
  if (current.kind !== 'location' && current.kind !== 'item')
    return noopRefusal('not-a-place-or-item', null)
  return buildStatePatchOutcome(
    bid,
    id,
    current,
    { condition: boundStateText(condition).text },
    ctx,
  )
}

export const updateEntityLocationTrackingHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'updateEntityLocationTracking')
    throw new Error(
      `handler/kind mismatch: expected 'updateEntityLocationTracking', got '${action.kind}'`,
    )
  const { branchId: bid, id, currentLocationId, lastSeenAt } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current)
    return { status: 'rejected', reason: `update target entities ${bid}:${id} not found` }
  const wrongKind = refuseNonCharacter(action.kind, current)
  if (wrongKind) return wrongKind
  const patch: Record<string, unknown> = {}
  if (currentLocationId !== undefined) patch.current_location_id = currentLocationId
  if (lastSeenAt !== undefined) patch.lastSeenAt = lastSeenAt
  if (Object.keys(patch).length === 0)
    return {
      status: 'rejected',
      reason: `updateEntityLocationTracking payload for ${bid}:${id} touches no field`,
    }
  return buildStatePatchOutcome(bid, id, current, patch, ctx)
}

export const promoteStagedEntityHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'promoteStagedEntity')
    throw new Error(`handler/kind mismatch: expected 'promoteStagedEntity', got '${action.kind}'`)
  const { branchId: bid, id, proseEntryId } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current) return noopRefusal(`promote target entities ${bid}:${id} not found`, 'gone')
  const held = entitiesStore.getById(id)
  const storeEntity = held?.branchId === bid ? held : undefined
  if (current.status !== 'staged' || (storeEntity !== undefined && storeEntity.status !== 'staged'))
    return noopRefusal('not-staged', current.status === 'active' ? 'restated' : null)
  if (await userWroteSinceProse(ctx, bid, id, proseEntryId, 'status'))
    return noopRefusal(USER_EDITED_SINCE_PROSE, null)
  return columnsWriteOutcome(bid, id, { status: 'active' }, { status: current.status }, ctx)
}

/**
 * Appends only the payload terms the row lacks as the write lands (cadence.md → User edits and
 * classifier writes); with `proseEntryId`, a term the user removed after that prose stays removed.
 */
export const appendEntityKeywordsHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'appendEntityKeywords')
    throw new Error(`handler/kind mismatch: expected 'appendEntityKeywords', got '${action.kind}'`)
  const { branchId: bid, id, keywords, proseEntryId } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current) return noopRefusal(`keyword target entities ${bid}:${id} not found`, 'gone')
  let added = newTerms(current.keywords, keywords)
  if (added.length === 0) return noopRefusal('no-new-keywords', 'restated')
  if (proseEntryId !== null) {
    const removed = priorTerms(await userEditsSinceProse(ctx, bid, 'entities', id, proseEntryId))
    added = added.filter((term) => !removed.has(normalizeTerm(term)))
    if (added.length === 0) return noopRefusal(USER_EDITED_SINCE_PROSE, null)
  }
  const next = [...current.keywords, ...added]
  return columnsWriteOutcome(bid, id, { keywords: next }, { keywords: current.keywords }, ctx)
}

/**
 * The removed term a live flag's pair rests on once `next` lands, with the pair's other row's name,
 * or null (world.md → Surfacing: a keyword can make two rows namesakes). A dormant flag is skipped.
 */
async function flagPairTerm(
  ctx: DbCtx,
  current: Entity,
  next: readonly string[],
  removed: readonly string[],
): Promise<{ term: string; other: string } | null> {
  const partnerId = current.nameCollisionPartnerId
  const rows = await ctx.db
    .select()
    .from(entities)
    .where(
      and(
        eq(entities.branchId, current.branchId),
        or(
          eq(entities.id, current.id),
          eq(entities.nameCollisionPartnerId, current.id),
          partnerId == null ? undefined : eq(entities.id, partnerId),
        ),
      ),
    )
  const byId = new Map(rows.map((row) => [row.id, row]))
  const after = new Map([[current.id, { ...pairSideOf(current), keywords: next }]])
  for (const flaggedId of brokenFlags({ entities: rows, after })) {
    const flagged = byId.get(flaggedId)
    const partner =
      flagged?.nameCollisionPartnerId == null ? undefined : byId.get(flagged.nameCollisionPartnerId)
    if (flagged === undefined || partner === undefined || !flagStillHolds(flagged, partner))
      continue
    const other = flagged.id === current.id ? partner : flagged
    const namesOther = (term: string) =>
      namesakeBasis(
        { name: current.name, keywords: [term] },
        { name: other.name, keywords: [] },
      ) !== null
    return { term: removed.find(namesOther) ?? removed[0], other: other.name }
  }
  return null
}

/**
 * chapter-close.md → 3f, Keywords: adds and removals in one `keywords` write, checked as it lands.
 * Only a machine's term goes, and never one a live flag's pair rests on.
 */
export const setEntityKeywordsHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'setEntityKeywords')
    throw new Error(`handler/kind mismatch: expected 'setEntityKeywords', got '${action.kind}'`)
  const { branchId: bid, id, add, remove, proseEntryId } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current) return noopRefusal(`keyword target entities ${bid}:${id} not found`, 'gone')
  const edit = await planKeywordEdit(
    ctx,
    { table: 'entities', branchId: bid, id, keywords: current.keywords },
    { add, remove, proseEntryId },
  )
  if (edit.kind === 'user-term') {
    const { term } = edit
    return noopRefusal(keywordUserAddedReason(term), null)
  }
  if (edit.kind === 'unchanged')
    return edit.userDropped
      ? noopRefusal(USER_EDITED_SINCE_PROSE, null)
      : noopRefusal('no-keyword-change', 'restated')
  if (edit.removed.length > 0) {
    const pair = await flagPairTerm(ctx, current, edit.next, edit.removed)
    if (pair !== null) {
      const { term, other } = pair
      return noopRefusal(keywordPairsFlagReason(term, other), null)
    }
  }
  return columnsWriteOutcome(bid, id, { keywords: edit.next }, { keywords: current.keywords }, ctx)
}

/** active → retired only, checked as the write lands, so a user-moved row keeps its status. */
export const retireEntityHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'retireEntity')
    throw new Error(`handler/kind mismatch: expected 'retireEntity', got '${action.kind}'`)
  const { branchId: bid, id, retiredReason, proseEntryId } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current) return noopRefusal(`retire target entities ${bid}:${id} not found`, 'gone')
  if (current.status !== 'active')
    return noopRefusal('not-active', current.status === 'retired' ? 'restated' : null)
  // Only the user retires a place (classifier.md → What the classifier writes).
  if (current.kind === 'location') return noopRefusal('location', null)
  if (await userWroteSinceProse(ctx, bid, id, proseEntryId, 'status'))
    return noopRefusal(USER_EDITED_SINCE_PROSE, null)
  return columnsWriteOutcome(
    bid,
    id,
    { status: 'retired', retiredReason },
    { status: current.status, retiredReason: current.retiredReason },
    ctx,
  )
}

/** The membership target's kind, undefined if gone; a row this group creates is a faction. */
async function membershipKind(
  ctx: DbCtx,
  branchId: string,
  id: string,
  group: GroupScope | undefined,
): Promise<Entity['kind'] | undefined> {
  if (group?.created.has(createdKey('entities', id))) return 'faction'
  const [row] = await ctx.db
    .select({ kind: entities.kind })
    .from(entities)
    .where(and(eq(entities.branchId, branchId), eq(entities.id, id)))
  return row?.kind
}

/** cadence.md → User edits and classifier writes: `state.faction_id` alone, against the live row. */
export const setCharacterFactionHandler: ActionHandler = async (action, branchId, ctx, group) => {
  if (action.kind !== 'setCharacterFaction')
    throw new Error(`handler/kind mismatch: expected 'setCharacterFaction', got '${action.kind}'`)
  const { branchId: bid, id, factionId, proseEntryId } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current) return noopRefusal(`faction target entities ${bid}:${id} not found`, 'gone')
  if (current.kind !== 'character') return noopRefusal('not-a-character', null)
  if (characterFactionId(current) === factionId) return noopRefusal('faction-unchanged', 'restated')
  if (factionId !== null) {
    const kind = await membershipKind(ctx, bid, factionId, group)
    if (kind !== 'faction') return noopRefusal('not-a-faction', kind === undefined ? 'gone' : null)
  }
  if (await userWroteSinceProse(ctx, bid, id, proseEntryId, 'state', ['faction_id']))
    return noopRefusal(USER_EDITED_SINCE_PROSE, null)
  return buildStatePatchOutcome(bid, id, current, { faction_id: factionId }, ctx)
}

/**
 * data-model.md → LocationState shape: parent and `unplaced` flag written as the row's whole state.
 * Refusals past the branch check are noops; an unmarked one would fail the pass that planned it.
 */
export const placeLocationHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'placeLocation')
    throw new Error(`handler/kind mismatch: expected 'placeLocation', got '${action.kind}'`)
  const { branchId: bid, id, placement, proseEntryId } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current) return noopRefusal(`place target entities ${bid}:${id} not found`, 'gone')
  if (current.kind !== 'location') return noopRefusal('not-a-location', null)
  const stored = placementOf(current)
  if (samePlacement(stored, placement)) return noopRefusal('placement-unchanged', 'restated')

  const places = await branchPlaces(ctx, bid)
  if (placement.kind === 'top') {
    if (realPlacementOf(places)(id).kind !== 'unplaced') return noopRefusal('not-unplaced', null)
  } else {
    const parent = places.find((p) => p.id === placement.parentId)
    if (parent === undefined) {
      const gone = (await loadCurrent(bid, placement.parentId, ctx)) === undefined
      return noopRefusal('parent-not-a-place', gone ? 'gone' : null)
    }
    if (parent.status === 'retired') return noopRefusal(PLACE_REFUSAL.retiredParent, null)
    const chainRefusal = parentChainRefusal(bid, id, placement.parentId, places)
    if (chainRefusal !== null) return noopRefusal(chainRefusal, null)
    // data-model.md → Disabled places. The per-turn writer's planner judges its own: its turn's
    // location lands beside it, so the story's place read here would already be the one walked into.
    if (
      action.source === 'periodic_classifier' &&
      moveHidesStory({
        id,
        parentId: placement.parentId,
        places: new Map(places.map((p) => [p.id, p])),
        parentOf: parentOfLocations(places),
        story: await loadStoryPlace(bid, ctx),
      })
    )
      return noopRefusal(PLACE_REFUSAL.storyInside, null)
  }
  if (await userWroteSinceProse(ctx, bid, id, proseEntryId, 'state', ['parent_location_id']))
    return noopRefusal(USER_EDITED_SINCE_PROSE, null)
  const next = withPlacement(stateOf(current, 'location'), placement)
  return stateWriteOutcome(bid, id, current, next, ctx)
}

// classifier.md → What the classifier writes → Names, on the rows as the write lands: a write the
// planner counted on can have been refused since.
async function oldestHolder(
  ctx: DbCtx,
  current: Entity,
  name: string,
): Promise<Entity | undefined> {
  const rows = await ctx.db
    .select({
      id: entities.id,
      name: entities.name,
      state: entities.state,
      createdAt: entities.createdAt,
    })
    .from(entities)
    .where(and(eq(entities.branchId, current.branchId), eq(entities.kind, current.kind)))
  const [holder] = nameHolders(current, name, rows, realPlacementOf(rows))
  return holder === undefined ? undefined : loadCurrent(current.branchId, holder.id, ctx)
}

/**
 * Why `row`, as the write leaves it, takes no flag naming `partner`, or null. A row whose flag still
 * holds keeps its partner, one per row; a dormant flag counts as none (classifier.md → Names).
 */
async function raiseRefusal(
  ctx: DbCtx,
  row: Entity,
  partner: Entity,
  reason: CollisionReason,
  edits: readonly Delta[],
): Promise<'already-flagged' | 'not-namesakes' | typeof USER_EDITED_SINCE_PROSE | null> {
  if (row.nameCollisionFlag === 1) {
    const flagged =
      row.nameCollisionPartnerId === null
        ? undefined
        : await loadCurrent(row.branchId, row.nameCollisionPartnerId, ctx)
    if (flagStillHolds(row, flagged)) return 'already-flagged'
  }
  // World's pairing rule: a raise needs a pair.
  if (!stillPaired(reason, pairSideOf(row), pairSideOf(partner))) return 'not-namesakes'
  // A user's clear stands against older prose; newer prose may raise the flag again.
  if (wroteField(edits, 'entities', 'nameCollisionFlag', [])) return USER_EDITED_SINCE_PROSE
  return null
}

const flagColumns = (partnerId: string, reason: CollisionReason) => ({
  nameCollisionFlag: 1,
  nameCollisionPartnerId: partnerId,
  nameCollisionReason: reason,
})

const flagUndo = (row: Entity) => ({
  nameCollisionFlag: row.nameCollisionFlag,
  nameCollisionPartnerId: row.nameCollisionPartnerId,
  nameCollisionReason: row.nameCollisionReason,
})

// No delta says which pair a clear answered: a user edit whose undo held this pair's flag did.
async function userResolvedPair(ctx: DbCtx, a: Entity, b: Entity): Promise<boolean> {
  for (const [row, other] of [
    [a, b],
    [b, a],
  ] as const) {
    const edits = await userEditsSince(ctx, row.branchId, 'entities', row.id, 0)
    if (
      edits.some(
        ({ undoPayload }) =>
          undoPayload?.nameCollisionFlag === 1 && undoPayload.nameCollisionPartnerId === other.id,
      )
    )
      return true
  }
  return false
}

/**
 * chapter-close.md → 3f: a close's duplicate re-marks the pair's live flag, restates one already
 * duplicate, and never asks a pair the user resolved, either row, any time. Null: raise as any.
 */
async function duplicateOutcome(
  ctx: DbCtx,
  current: Entity,
  partner: Entity,
  edits: readonly Delta[],
): Promise<HandlerOutcome | null> {
  if (flagStillHolds(current, partner)) {
    if (current.nameCollisionReason === 'duplicate')
      return noopRefusal('already-flagged', 'restated')
    if (wroteField(edits, 'entities', 'nameCollisionFlag', []))
      return noopRefusal(USER_EDITED_SINCE_PROSE, null)
    return columnsWriteOutcome(
      current.branchId,
      current.id,
      flagColumns(partner.id, 'duplicate'),
      flagUndo(current),
      ctx,
    )
  }
  // The close's plan writes the row that holds the pair's flag, so landing here is its slip.
  if (flagStillHolds(partner, current))
    return partner.nameCollisionReason === 'duplicate'
      ? noopRefusal('already-flagged', 'restated')
      : noopRefusal('flag-held-by-partner', null)
  if (await userResolvedPair(ctx, current, partner)) return noopRefusal('pair-resolved', null)
  return null
}

/** classifier.md → Names: the name joins the keywords and the flag names the holder, for merging. */
async function renameClashOutcome(
  ctx: HandlerCtx,
  current: Entity,
  name: string,
  holder: Entity,
  edits: readonly Delta[],
): Promise<HandlerOutcome> {
  const { branchId, id } = current
  const removed = priorTerms(edits)
  const kept = newTerms(current.keywords, [name]).filter(
    (term) => !removed.has(normalizeTerm(term)),
  )
  const keywords = [...current.keywords, ...kept]
  // Against the row as this write leaves it: the keyword can be what pairs the two.
  const refused = await raiseRefusal(ctx, { ...current, keywords }, holder, 'name-taken', edits)
  const flagged = refused === null
  logger.warn(
    'classifier.rename_clash',
    { ref: id, name, partnerId: holder.id, flagged },
    { actionId: ctx.actionId },
  )
  if (kept.length === 0 && !flagged) return noopRefusal('name-taken', null)
  return columnsWriteOutcome(
    branchId,
    id,
    {
      ...(kept.length > 0 ? { keywords } : {}),
      ...(flagged ? flagColumns(holder.id, 'name-taken') : {}),
    },
    {
      ...(kept.length > 0 ? { keywords: current.keywords } : {}),
      ...(flagged ? flagUndo(current) : {}),
    },
    ctx,
  )
}

/** classifier.md → What the classifier writes → Names: a rename or a clash, as the write lands. */
export const renameEntityHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'renameEntity')
    throw new Error(`handler/kind mismatch: expected 'renameEntity', got '${action.kind}'`)
  const { branchId: bid, id, proseEntryId } = action.payload
  const name = action.payload.name.trim()
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current) return noopRefusal(`rename target entities ${bid}:${id} not found`, 'gone')
  if (name === '') return noopRefusal('name-blank', null)
  // The same name by World's namesake rule (case and spacing aside) is no reveal.
  if (nameBasis(name, current.name) === 'same-name')
    return noopRefusal('name-unchanged', 'restated')
  const edits =
    proseEntryId === null ? [] : await userEditsSinceProse(ctx, bid, 'entities', id, proseEntryId)
  const holder = await oldestHolder(ctx, current, name)
  if (holder !== undefined) return renameClashOutcome(ctx, current, name, holder, edits)
  if (wroteField(edits, 'entities', 'name', [])) return noopRefusal(USER_EDITED_SINCE_PROSE, null)
  // The old name joins the keywords unless they hold it, or the user removed it after the prose.
  const removed = priorTerms(edits)
  const kept = newTerms(current.keywords, [current.name]).filter(
    (term) => !removed.has(normalizeTerm(term)),
  )
  const keywords = kept.length > 0 ? { keywords: [...current.keywords, ...kept] } : {}
  // `name` is an embedded field (KIND_FIELDS.entity), so the row re-embeds.
  return columnsWriteOutcome(
    bid,
    id,
    { name, ...keywords, embeddingStale: 1 },
    { name: current.name, ...(kept.length > 0 ? { keywords: current.keywords } : {}) },
    ctx,
  )
}

/** edge-cases.md → Layer B; chapter-close.md → 3f for a close's duplicate. */
export const raiseCollisionFlagHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'raiseCollisionFlag')
    throw new Error(`handler/kind mismatch: expected 'raiseCollisionFlag', got '${action.kind}'`)
  const { branchId: bid, id, partnerId, reason, proseEntryId } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current) return noopRefusal(`flag target entities ${bid}:${id} not found`, 'gone')
  if (partnerId === id) return noopRefusal('partner-is-self', null)
  const partner = await loadCurrent(bid, partnerId, ctx)
  if (partner === undefined) return noopRefusal('partner-not-found', 'gone')
  if (partner.kind !== current.kind) return noopRefusal('partner-not-of-kind', null)
  const edits =
    proseEntryId === null ? [] : await userEditsSinceProse(ctx, bid, 'entities', id, proseEntryId)
  if (reason === 'duplicate') {
    const outcome = await duplicateOutcome(ctx, current, partner, edits)
    if (outcome !== null) return outcome
  }
  const refused = await raiseRefusal(ctx, current, partner, reason, edits)
  if (refused !== null) {
    // Any other live flag is the one-flag-per-row rule; only the same flag again is a stored value.
    const sameFlag =
      current.nameCollisionPartnerId === partner.id && current.nameCollisionReason === reason
    return noopRefusal(refused, refused === 'already-flagged' && sameFlag ? 'restated' : null)
  }
  return columnsWriteOutcome(bid, id, flagColumns(partnerId, reason), flagUndo(current), ctx)
}

/** classifier.md → Factions: `state.standing` alone, cut to the schema's 500 as a condition is. */
export const setFactionStandingHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'setFactionStanding')
    throw new Error(`handler/kind mismatch: expected 'setFactionStanding', got '${action.kind}'`)
  const { branchId: bid, id, proseEntryId } = action.payload
  const bounded = boundStateText(action.payload.standing).text
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current) return noopRefusal(`standing target entities ${bid}:${id} not found`, 'gone')
  if (current.kind !== 'faction') return noopRefusal('not-a-faction', null)
  if (stateOf(current, 'faction').standing === bounded)
    return noopRefusal('standing-unchanged', 'restated')
  if (await userWroteSinceProse(ctx, bid, id, proseEntryId, 'state', ['standing']))
    return noopRefusal(USER_EDITED_SINCE_PROSE, null)
  return buildStatePatchOutcome(bid, id, current, { standing: bounded }, ctx)
}

/**
 * retired → active on a character only, checked as the write lands so a status the user wrote
 * since stands; clears the reason with the status.
 */
export const returnFromRetirementHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'returnFromRetirement')
    throw new Error(`handler/kind mismatch: expected 'returnFromRetirement', got '${action.kind}'`)
  const { branchId: bid, id, proseEntryId } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const current = await loadCurrent(bid, id, ctx)
  if (!current) return noopRefusal(`return target entities ${bid}:${id} not found`, 'gone')
  if (current.kind !== 'character') return noopRefusal('not-a-character', null)
  if (current.status !== 'retired')
    return noopRefusal('not-retired', current.status === 'active' ? 'restated' : null)
  if (await userWroteSinceProse(ctx, bid, id, proseEntryId, 'status'))
    return noopRefusal(USER_EDITED_SINCE_PROSE, null)
  return columnsWriteOutcome(
    bid,
    id,
    { status: 'active', retiredReason: null },
    { status: current.status, retiredReason: current.retiredReason },
    ctx,
  )
}
