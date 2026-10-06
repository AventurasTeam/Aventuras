import type { Entity } from '@/lib/db'
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
  entityKeepActions,
  entityMergeActions,
  entityRenameActions,
  namesakeKey,
  PARENT_CHAIN_BROKEN,
  PARENT_CYCLE,
  renameIssue,
  type DeleteTail,
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
      tags: readonly string[]
      keywords: readonly string[]
    }
  | { mode: 'rename'; ids: readonly [string, string]; names: readonly [string, string] }
  | { mode: 'keep'; ids: readonly [string, string] }

export type CollisionResolveResult =
  | { status: 'ok' }
  | { status: 'rejected'; reason: string; code: CollisionRejectionCode }

type MergeResolution = Extract<CollisionResolution, { mode: 'merge' }>
type PairResolution = Exclude<CollisionResolution, { mode: 'merge' }>
type Refusal = Extract<BuiltGroup, { status: 'rejected' }>
type PairLookup = { pair: readonly [Entity, Entity] } | { refusal: Refusal }

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

function branchRows<T extends { branchId: string }>(
  rows: ReadonlyMap<string, T>,
  branchId: string,
): T[] {
  return [...rows.values()].filter((r) => r.branchId === branchId)
}

function lookupPair(branchEntities: readonly Entity[], ids: readonly [string, string]): PairLookup {
  // The planners throw on equal ids (a programming error there); here it's a stale or bad request.
  if (ids[0] === ids[1])
    return { refusal: refusal(COLLISION_REJECTION.notFound, 'a row cannot collide with itself') }
  const first = branchEntities.find((e) => e.id === ids[0])
  const second = branchEntities.find((e) => e.id === ids[1])
  if (first == null || second == null)
    return {
      refusal: refusal(
        COLLISION_REJECTION.notFound,
        `entity ${first == null ? ids[0] : ids[1]} not found`,
      ),
    }
  if (first.kind !== second.kind || namesakeKey(first) !== namesakeKey(second))
    return { refusal: refusal(COLLISION_REJECTION.notFound, 'the two rows no longer collide') }
  return { pair: [first, second] }
}

// For a merge, the first check predates the tail-lock awaits; a hard-gate run started since has
// settled user writes without this one. The store read and the plan follow with no await between.
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
  const lookup = lookupPair(branchEntities, [resolution.canonicalId, resolution.loserId])
  if ('refusal' in lookup) return lookup.refusal
  const [canonical, loser] = lookup.pair
  const { actions } = entityMergeActions({
    branchId,
    canonical,
    loser,
    fromLoser: resolution.fromLoser,
    tags: resolution.tags,
    keywords: resolution.keywords,
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
  const lookup = lookupPair(branchEntities, resolution.ids)
  if ('refusal' in lookup) return lookup.refusal
  const { pair } = lookup
  if (resolution.mode === 'keep')
    return { status: 'ok', actions: entityKeepActions({ branchId, pair }) }
  const issue = renameIssue(pair[0].kind, resolution.names)
  if (issue != null) return refusal(COLLISION_REJECTION.invalidRename, issue)
  return {
    status: 'ok',
    actions: entityRenameActions({ branchId, pair, names: resolution.names, branchEntities }),
  }
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
    ids:
      resolution.mode === 'merge'
        ? [resolution.canonicalId, resolution.loserId]
        : [...resolution.ids],
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
