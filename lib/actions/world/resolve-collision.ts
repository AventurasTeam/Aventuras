import { logger } from '@/lib/diagnostics'
import { generateId } from '@/lib/ids'
import {
  characterRelationshipsStore,
  entitiesStore,
  generationStore,
  happeningAwarenessStore,
  happeningInvolvementsStore,
} from '@/lib/stores'
import {
  COLLISION_PAIR_MISS,
  collisionPairOf,
  entityKeepActions,
  entityMergeActions,
  entityRenameActions,
  PARENT_CHAIN_BROKEN,
  PARENT_CYCLE,
  type CollisionPairMiss,
  type DeleteTail,
  type EntityRename,
  type MergeScalar,
} from '@/lib/world'

import {
  applyDeltaActionGroupBuilt,
  DELTA_REJECTION,
  type BuiltGroup,
  type DeltaGroupResult,
} from '../delta/apply-delta-action'
import { TARGET_NOT_FOUND } from '../delta/registry'
import { ENTITY_DELETE_REJECTION } from '../entities/register'
import { ROW_SAVE_REJECTION } from '../row-save/commit-row-save'
import { withEntryMetadataLock } from '../story-entries/entry-metadata-lock'
import { loadHeadTurn } from '../story-entries/head-turn'
import type { DbCtx } from '../types'
import { withMergeSceneEffects } from './merge-scene'

export const COLLISION_REJECTION = {
  inFlight: ROW_SAVE_REJECTION.inFlight,
  notFound: TARGET_NOT_FOUND,
  leadEntity: ENTITY_DELETE_REJECTION.leadEntity,
  parentCycle: PARENT_CYCLE,
  parentChainBroken: PARENT_CHAIN_BROKEN,
  invalidRename: 'invalid-rename',
  failed: 'failed',
} as const

export type CollisionRejectionCode = (typeof COLLISION_REJECTION)[keyof typeof COLLISION_REJECTION]

export type CollisionResolution =
  | {
      mode: 'merge'
      canonicalId: string
      loserId: string
      fromLoser: readonly MergeScalar[]
      /**
       * The terms the user dropped (tags trimmed, keywords matched by `normalizeTerm`), never the
       * final lists: the build unions the rows it reads under the branch lock, so a term a no-gate
       * pass adds while the merge waits is kept.
       */
      deselectedTags: readonly string[]
      deselectedKeywords: readonly string[]
    }
  | {
      mode: 'rename'
      /** Both rows of the pair, an unchanged one under its current name. */
      renames: readonly [EntityRename, EntityRename]
    }
  | { mode: 'keep'; ids: readonly [string, string] }

export type CollisionResolveResult =
  | { status: 'ok' }
  | { status: 'rejected'; reason: string; code: CollisionRejectionCode }

type MergeResolution = Extract<CollisionResolution, { mode: 'merge' }>
type PairResolution = Exclude<CollisionResolution, { mode: 'merge' }>
type Refusal = Extract<BuiltGroup, { status: 'rejected' }>

function refusal(code: CollisionRejectionCode, reason: string): Refusal {
  return { status: 'rejected', reason, code }
}

// A reversal raised while the write awaited its locks reports as in-flight, like the entry gate.
function rejectionCode(code: string | undefined): CollisionRejectionCode {
  switch (code) {
    case DELTA_REJECTION.reversalInProgress:
    case COLLISION_REJECTION.inFlight:
      return COLLISION_REJECTION.inFlight
    case COLLISION_REJECTION.notFound:
      return COLLISION_REJECTION.notFound
    case COLLISION_REJECTION.leadEntity:
      return COLLISION_REJECTION.leadEntity
    case COLLISION_REJECTION.parentCycle:
      return COLLISION_REJECTION.parentCycle
    case COLLISION_REJECTION.parentChainBroken:
      return COLLISION_REJECTION.parentChainBroken
    case COLLISION_REJECTION.invalidRename:
      return COLLISION_REJECTION.invalidRename
    default:
      return COLLISION_REJECTION.failed
  }
}

function pairIds(resolution: CollisionResolution): readonly [string, string] {
  switch (resolution.mode) {
    case 'merge':
      return [resolution.canonicalId, resolution.loserId]
    case 'rename':
      return [resolution.renames[0].id, resolution.renames[1].id]
    case 'keep':
      return resolution.ids
  }
}

function branchRows<T extends { branchId: string }>(
  rows: ReadonlyMap<string, T>,
  branchId: string,
): T[] {
  return [...rows.values()].filter((r) => r.branchId === branchId)
}

// Every miss reports as not-found: the pair the dialog showed no longer exists as asked.
function missRefusal(lookup: CollisionPairMiss): Refusal {
  switch (lookup.miss) {
    case COLLISION_PAIR_MISS.sameRow:
      return refusal(COLLISION_REJECTION.notFound, 'a row cannot collide with itself')
    case COLLISION_PAIR_MISS.notFound:
      return refusal(COLLISION_REJECTION.notFound, `entity ${lookup.id} not found`)
    case COLLISION_PAIR_MISS.notColliding:
      return refusal(COLLISION_REJECTION.notFound, 'the two rows no longer collide')
  }
}

// For a merge, the first check predates the tail-lock awaits; a hard-gate run started since has
// settled user writes without this one.
function gateRefusal(): Refusal | null {
  return generationStore.isUserEditBlocked()
    ? refusal(COLLISION_REJECTION.inFlight, 'generation in flight')
    : null
}

function buildMerge(
  branchId: string,
  resolution: MergeResolution,
  tail: DeleteTail | null,
): BuiltGroup {
  const gated = gateRefusal()
  if (gated) return gated
  const branchEntities = branchRows(entitiesStore.getEntities(), branchId)
  const lookup = collisionPairOf(branchEntities, pairIds(resolution))
  if ('miss' in lookup) return missRefusal(lookup)
  const { pair } = lookup
  const [canonical] = pair
  const { actions } = entityMergeActions({
    branchId,
    pair,
    canonicalId: canonical.id,
    fromLoser: resolution.fromLoser,
    deselectedTags: resolution.deselectedTags,
    deselectedKeywords: resolution.deselectedKeywords,
    branchEntities,
    awareness: branchRows(happeningAwarenessStore.getAwareness(), branchId),
    involvements: branchRows(happeningInvolvementsStore.getInvolvements(), branchId),
    relationships: branchRows(characterRelationshipsStore.getRelationshipRows(), branchId),
    tail,
    newId: generateId,
  })
  return {
    status: 'ok',
    actions: withMergeSceneEffects({ branchId, actions, canonical, tail }),
  }
}

function buildPairResolution(branchId: string, resolution: PairResolution): BuiltGroup {
  const gated = gateRefusal()
  if (gated) return gated
  const branchEntities = branchRows(entitiesStore.getEntities(), branchId)
  const lookup = collisionPairOf(branchEntities, pairIds(resolution))
  if ('miss' in lookup) return missRefusal(lookup)
  const { pair } = lookup
  if (resolution.mode === 'keep')
    return { status: 'ok', actions: entityKeepActions({ branchId, pair }) }
  const plan = entityRenameActions({ branchId, pair, renames: resolution.renames, branchEntities })
  return 'issue' in plan
    ? refusal(COLLISION_REJECTION.invalidRename, plan.issue)
    : { status: 'ok', actions: plan.actions }
}

function commit(branchId: string, build: () => BuiltGroup, ctx: DbCtx): Promise<DeltaGroupResult> {
  return applyDeltaActionGroupBuilt(build, { actionId: generateId('act'), branchId }, ctx)
}

function tailOf(head: Awaited<ReturnType<typeof loadHeadTurn>>): DeleteTail | null {
  const metadata = head?.tail.metadata
  return head == null || metadata == null
    ? null
    : {
        id: head.tail.id,
        sceneEntities: metadata.sceneEntities,
        currentLocationId: metadata.currentLocationId,
      }
}

/** world.md → Delete: the merge rewrites the tail scene, so it holds the tail's metadata lock. */
async function commitMerge(
  branchId: string,
  resolution: MergeResolution,
  ctx: DbCtx,
): Promise<DeltaGroupResult> {
  const lockedTail = (await loadHeadTurn(branchId, ctx))?.tail.id ?? null
  const run = async (): Promise<DeltaGroupResult> => {
    const head = await loadHeadTurn(branchId, ctx)
    if ((head?.tail.id ?? null) !== lockedTail)
      return refusal(COLLISION_REJECTION.inFlight, 'tail moved')
    const tail = tailOf(head)
    return commit(branchId, () => buildMerge(branchId, resolution, tail), ctx)
  }
  return lockedTail == null ? run() : withEntryMetadataLock(branchId, lockedTail, run)
}

function dispatch(
  branchId: string,
  resolution: CollisionResolution,
  ctx: DbCtx,
): Promise<DeltaGroupResult> {
  if (resolution.mode === 'merge') return commitMerge(branchId, resolution, ctx)
  const pairResolution: PairResolution = resolution
  return commit(branchId, () => buildPairResolution(branchId, pairResolution), ctx)
}

function rejected(
  context: Record<string, unknown>,
  code: CollisionRejectionCode,
  reason: string,
): CollisionResolveResult {
  logger.warn('action_layer.collision_resolve_rejected', { ...context, code, reason })
  return { status: 'rejected', reason, code }
}

/**
 * world.md → Collision review and entity merge: one resolution = one `action_id`, built under the
 * branch lock.
 */
export async function resolveCollision(
  branchId: string,
  resolution: CollisionResolution,
  ctx: DbCtx,
): Promise<CollisionResolveResult> {
  const context: Record<string, unknown> = {
    branchId,
    mode: resolution.mode,
    ids: [...pairIds(resolution)],
  }
  // generation-pipeline.md → Action rejection — defense in depth: the UI disables Resolve first.
  if (generationStore.isUserEditBlocked())
    return rejected(context, COLLISION_REJECTION.inFlight, 'generation in flight')
  let result: DeltaGroupResult
  try {
    result = await dispatch(branchId, resolution, ctx)
  } catch (error) {
    logger.error('action_layer.collision_resolve_failed', {
      ...context,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
  if (result.status !== 'ok') {
    const code = rejectionCode(result.code)
    const raw = result.code != null && result.code !== code ? { rawCode: result.code } : {}
    return rejected({ ...context, ...raw }, code, result.reason)
  }
  return { status: 'ok' }
}
