import { readStampedLeadIds, type StoryEntry } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import type { HeadTurn } from '@/lib/head-turn'
import { generateId } from '@/lib/ids'
import { readSceneSource } from '@/lib/pipeline'
import {
  characterRelationshipsStore,
  entitiesStore,
  generationStore,
  happeningAwarenessStore,
  happeningInvolvementsStore,
  happeningsStore,
} from '@/lib/stores'
import {
  COLLISION_PAIR_MISS,
  collisionPairOf,
  deleteTailOf,
  entityKeepActions,
  entityMergeActions,
  entityRenameActions,
  mergePlaceRefusal,
  PARENT_CHAIN_BROKEN,
  PARENT_CYCLE,
  PLACE_REFUSAL,
  storyPlaceOf,
  type CollisionPairMiss,
  type EntityRename,
  type MergeScalar,
  type StoryPlace,
} from '@/lib/world'

import {
  applyDeltaActionGroup,
  DELTA_REJECTION,
  type DeltaGroupResult,
} from '../delta/apply-delta-action'
import { TARGET_NOT_FOUND } from '../delta/registry'
import { ROW_SAVE_REJECTION } from '../row-save/commit-row-save'
import { withBranchLeadLock } from '../stories/set-lead'
import { withTailMetadataLock } from '../story-entries/entry-metadata-lock'
import type { DbCtx, PipelineAction } from '../types'

export const COLLISION_REJECTION = {
  inFlight: ROW_SAVE_REJECTION.inFlight,
  notFound: TARGET_NOT_FOUND,
  leadEntity: 'lead-entity',
  parentCycle: PARENT_CYCLE,
  parentChainBroken: PARENT_CHAIN_BROKEN,
  storyInside: PLACE_REFUSAL.storyInside,
  placesInside: PLACE_REFUSAL.placesInside,
  retiredParent: PLACE_REFUSAL.retiredParent,
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
       * Terms the user dropped (tags trimmed, keywords by `normalizeTerm`), never final lists: the
       * build unions the rows as they stand when it commits.
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
type Built =
  | { status: 'ok'; actions: readonly PipelineAction[] }
  | { status: 'rejected'; reason: string; code: CollisionRejectionCode }
type Refusal = Extract<Built, { status: 'rejected' }>

function refusal(code: CollisionRejectionCode, reason: string): Refusal {
  return { status: 'rejected', reason, code }
}

const COLLISION_CODES: ReadonlySet<string> = new Set(Object.values(COLLISION_REJECTION))

function isCollisionCode(code: string): code is CollisionRejectionCode {
  return COLLISION_CODES.has(code)
}

// A reversal raised while the write awaited its locks reports as in-flight, like the entry gate.
function rejectionCode(code: string | undefined): CollisionRejectionCode {
  if (code === DELTA_REJECTION.reversalInProgress) return COLLISION_REJECTION.inFlight
  return code != null && isCollisionCode(code) ? code : COLLISION_REJECTION.failed
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

// Every miss reports as not-found: the pair the dialog showed no longer exists as asked.
function missRefusal(lookup: CollisionPairMiss): Refusal {
  switch (lookup.miss) {
    case COLLISION_PAIR_MISS.sameRow:
      return refusal(COLLISION_REJECTION.notFound, 'a row cannot collide with itself')
    case COLLISION_PAIR_MISS.notFound:
      return refusal(COLLISION_REJECTION.notFound, `entity ${lookup.id} not found`)
    case COLLISION_PAIR_MISS.notFlagged:
      return refusal(COLLISION_REJECTION.notFound, 'the two rows are no longer flagged as a pair')
  }
}

// For a merge, the first check predates the tail-lock awaits; a hard-gate run started since has
// settled user writes without this one.
function gateRefusal(): Refusal | null {
  return generationStore.isUserEditBlocked()
    ? refusal(COLLISION_REJECTION.inFlight, 'generation in flight')
    : null
}

function buildResolution(
  branchId: string,
  resolution: CollisionResolution,
  head: HeadTurn<StoryEntry> | null,
  story: StoryPlace,
): Built {
  const gated = gateRefusal()
  if (gated) return gated
  const branchEntities = [...entitiesStore.getEntities(branchId).values()]
  const lookup = collisionPairOf(branchEntities, pairIds(resolution))
  if ('miss' in lookup) return missRefusal(lookup)
  const { pair } = lookup
  switch (resolution.mode) {
    case 'merge': {
      const loser = pair.find((e) => e.id === resolution.loserId)
      // world.md → Merge: the backstop to the fixed picker, from the pair this tick reads.
      if (loser?.isLead === 1)
        return refusal(COLLISION_REJECTION.leadEntity, "the losing row is the branch's lead")
      const tail = deleteTailOf(head)
      const actions = entityMergeActions({
        branchId,
        pair,
        canonicalId: resolution.canonicalId,
        fromLoser: resolution.fromLoser,
        deselectedTags: resolution.deselectedTags,
        deselectedKeywords: resolution.deselectedKeywords,
        branchEntities,
        branchHappenings: [...happeningsStore.getHappenings(branchId).values()],
        branchAwareness: [...happeningAwarenessStore.getAwareness(branchId).values()],
        branchInvolvements: [...happeningInvolvementsStore.getInvolvements(branchId).values()],
        branchRelationships: [
          ...characterRelationshipsStore.getRelationshipRows(branchId).values(),
        ],
        story,
        tail,
        newId: generateId,
      })
      const canonical = pair.find((e) => e.id === resolution.canonicalId)
      if (canonical?.kind === 'location' && loser !== undefined) {
        // world.md → Merge: the checks a Save runs, on the place the merge would leave.
        const code = mergePlaceRefusal({
          canonical,
          loser,
          actions,
          branchEntities,
          story,
        })
        if (code != null) return refusal(code, `the merged place breaks a place rule: ${code}`)
      }
      return { status: 'ok', actions }
    }
    case 'rename': {
      const { renames } = resolution
      const plan = entityRenameActions({ branchId, pair, renames, branchEntities })
      return 'issue' in plan
        ? refusal(COLLISION_REJECTION.invalidRename, plan.issue)
        : { status: 'ok', actions: plan.actions }
    }
    case 'keep':
      return { status: 'ok', actions: entityKeepActions({ branchId, pair, branchEntities }) }
  }
}

// Built and dispatched in one tick: a run that starts after the build's gate check settles this
// write before it reads.
async function commit(branchId: string, build: () => Built, ctx: DbCtx): Promise<DeltaGroupResult> {
  const built = build()
  if (built.status === 'rejected') return built
  return applyDeltaActionGroup(built.actions, { actionId: generateId('act'), branchId }, ctx)
}

/** The merge rewrites the tail scene, so it holds the tail's metadata lock around its write. */
async function commitMerge(
  branchId: string,
  resolution: MergeResolution,
  ctx: DbCtx,
): Promise<DeltaGroupResult> {
  return withTailMetadataLock<DeltaGroupResult>(
    branchId,
    ctx,
    async (head) => {
      // Stamp reach, read before the build; a newer entry is stamped with the flagged lead,
      // which the build's own check sees.
      const [sceneSource, stamped] = await Promise.all([
        readSceneSource(ctx.db, branchId),
        readStampedLeadIds(branchId, [resolution.loserId], ctx.db),
      ])
      if (stamped.has(resolution.loserId))
        return refusal(
          COLLISION_REJECTION.leadEntity,
          'an entry on the branch is stamped with the losing row as its lead',
        )
      const story = storyPlaceOf({ tail: head?.tail, sceneSource })
      // The build reads isLead off the store; the lock keeps a set out from build to commit.
      return withBranchLeadLock(branchId, () =>
        commit(branchId, () => buildResolution(branchId, resolution, head, story), ctx),
      )
    },
    () => refusal(COLLISION_REJECTION.inFlight, 'tail moved'),
  )
}

function dispatch(
  branchId: string,
  resolution: CollisionResolution,
  ctx: DbCtx,
): Promise<DeltaGroupResult> {
  if (resolution.mode === 'merge') return commitMerge(branchId, resolution, ctx)
  const nowhere = storyPlaceOf({ tail: null, sceneSource: null })
  return commit(branchId, () => buildResolution(branchId, resolution, null, nowhere), ctx)
}

function rejected(
  context: Record<string, unknown>,
  code: CollisionRejectionCode,
  reason: string,
): CollisionResolveResult {
  logger.warn('action_layer.collision_resolve_rejected', { ...context, code, reason })
  return { status: 'rejected', reason, code }
}

/** world.md → Collision review and entity merge: one resolution = one `action_id`. */
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
