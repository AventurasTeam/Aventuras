import { skipToken, useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { type EntitySummary, type Resolution } from '@/components/compounds/collision-resolve-diff'
import {
  COLLISION_REJECTION,
  resolveCollision,
  type CollisionRejectionCode,
  type CollisionResolution,
  type CollisionResolveResult,
  type DbCtx,
} from '@/lib/actions'
import { readStampedLeadIds, type CollisionReason, type Entity } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import {
  characterRelationshipsStore,
  entitiesStore,
  happeningAwarenessStore,
  happeningInvolvementsStore,
  happeningsStore,
  translationsStore,
} from '@/lib/stores'
import { toast } from '@/lib/toast'
import {
  collisionPairOf,
  flaggedSideOf,
  pairSideOf,
  type FlaggedEntity,
  type StoryPlace,
} from '@/lib/world'

import { collisionRejectionText } from './collision-copy'
import { collisionPair } from './collision-summary'

export type CollisionDialogPair = {
  /** Older by createdAt first: the dialog's entityA / entityB. */
  sides: readonly [EntitySummary, EntitySummary]
  /** The row whose flag names the other: the requested flagged row when it still does. */
  flaggedId: string
  reason: CollisionReason
  /** The shared parent's name for a `same-parent` pair; absent at the root or a missing row. */
  parentName?: string
}

type Sides = CollisionDialogPair['sides']

export type CollisionDialog = {
  pair: CollisionDialogPair
  /** The pair's rows the branch's entries name, by the lead flag or a lead stamp. */
  heldIds: readonly string[]
}

const NONE_HELD: readonly string[] = []

// Logged from the fetch, so one failure logs once however many renders see it.
async function readStamped(
  branchId: string,
  ids: readonly string[],
  db: DbCtx['db'],
): Promise<ReadonlySet<string>> {
  try {
    return await readStampedLeadIds(branchId, ids, db)
  } catch (error) {
    logger.error('app.world_collision_held_read_failed', {
      branchId,
      ids,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

// A toast lands after the dialog closed, so it can't tell the user to close it or pick a row in it.
const CLOSED_REJECTION_TEXT: Record<CollisionRejectionCode, () => string> = {
  [COLLISION_REJECTION.inFlight]: () => collisionRejectionText(COLLISION_REJECTION.inFlight),
  [COLLISION_REJECTION.notFound]: () => t('world:collision.closedRejection.notFound'),
  [COLLISION_REJECTION.leadEntity]: () => t('world:collision.closedRejection.leadEntity'),
  [COLLISION_REJECTION.parentCycle]: () => t('world:collision.closedRejection.parentCycle'),
  [COLLISION_REJECTION.parentChainBroken]: () =>
    collisionRejectionText(COLLISION_REJECTION.parentChainBroken),
  [COLLISION_REJECTION.storyInside]: () => t('world:collision.closedRejection.storyInside'),
  [COLLISION_REJECTION.placesInside]: () => t('world:collision.closedRejection.placesInside'),
  [COLLISION_REJECTION.retiredParent]: () => t('world:collision.closedRejection.retiredParent'),
  [COLLISION_REJECTION.invalidRename]: () =>
    collisionRejectionText(COLLISION_REJECTION.invalidRename),
  [COLLISION_REJECTION.failed]: () => collisionRejectionText(COLLISION_REJECTION.failed),
}

/** The flagged row's parent, which the pair rule makes the other's too (`same-parent` only). */
function sharedParentName(flagged: FlaggedEntity, entities: readonly Entity[]): string | undefined {
  if (flagged.nameCollisionReason !== 'same-parent') return undefined
  const { placement } = pairSideOf(flagged)
  if (placement.kind !== 'under') return undefined
  return entities.find((e) => e.id === placement.parentId)?.name
}

function toCollisionResolution(resolution: Resolution, [a, b]: Sides): CollisionResolution {
  switch (resolution.mode) {
    case 'merge': {
      const { canonicalId, fromOther, deselectedTags, deselectedKeywords } = resolution
      return {
        mode: 'merge',
        canonicalId,
        loserId: canonicalId === a.id ? b.id : a.id,
        fromLoser: fromOther,
        deselectedTags,
        deselectedKeywords,
      }
    }
    case 'rename': {
      const nameOf = (side: EntitySummary) =>
        resolution.renames.find((rename) => rename.id === side.id)?.newName ?? side.name
      return {
        mode: 'rename',
        renames: [
          { id: a.id, name: nameOf(a) },
          { id: b.id, name: nameOf(b) },
        ],
      }
    }
    case 'keep':
      return { mode: 'keep', ids: [a.id, b.id] }
  }
}

function resolvedText(resolution: CollisionResolution, sides: Sides): string {
  switch (resolution.mode) {
    case 'merge': {
      const nameFrom = resolution.fromLoser.includes('name')
        ? resolution.loserId
        : resolution.canonicalId
      const name = sides.find((side) => side.id === nameFrom)?.name ?? sides[0].name
      return t('world:collision.resolved.merge', { name })
    }
    case 'rename':
      return t('world:collision.resolved.rename')
    case 'keep':
      return t('world:collision.resolved.keep')
  }
}

/**
 * world.md → Resolve dialog. Pair read live under the resolve action's pair rule; closes for good
 * once a row is gone or no flag names the other, so an undo can't reopen it. `dialog` stays null
 * until this open's stamp read lands, so no picker shows free; the flag half reads live.
 */
export function useCollisionResolve(
  branchId: string,
  ctx: DbCtx,
  guard: (proceed: () => void) => void,
  story: StoryPlace,
): {
  dialog: CollisionDialog | null
  request: (flaggedId: string, otherId: string) => void
  close: () => void
  resolve: (resolution: Resolution) => Promise<void>
} {
  const [requested, setRequestedState] = useState<readonly [string, string] | null>(null)
  // Bumped per request, so a reopen never shows the last open's read: the dialog's mode is set
  // at mount.
  const [openSeq, setOpenSeq] = useState(0)
  // Read after the action settles: a request closed meanwhile has no dialog left to show an error.
  const requestedRef = useRef(requested)
  const setRequested = useCallback((next: readonly [string, string] | null) => {
    requestedRef.current = next
    setRequestedState(next)
  }, [])
  const open = requested != null
  // Subscribed only while open, so a closed dialog doesn't re-render the route on every link patch.
  const entityRows = entitiesStore.useEntities(branchId, (rows) => (open ? rows : null))
  const happeningRows = happeningsStore.useHappenings(branchId, (rows) => (open ? rows : null))
  const awarenessRows = happeningAwarenessStore.useAwareness(branchId, (rows) =>
    open ? rows : null,
  )
  const involvementRows = happeningInvolvementsStore.useInvolvements(branchId, (rows) =>
    open ? rows : null,
  )
  const relationshipRows = characterRelationshipsStore.useRelationships(branchId, (rows) =>
    open ? rows : null,
  )
  const translationRows = translationsStore.useTranslations(branchId, (rows) =>
    open ? rows : null,
  )

  const pair = useMemo((): CollisionDialogPair | null => {
    if (
      requested == null ||
      entityRows == null ||
      happeningRows == null ||
      awarenessRows == null ||
      involvementRows == null ||
      relationshipRows == null ||
      translationRows == null
    )
      return null
    const branchEntities = [...entityRows.values()]
    const lookup = collisionPairOf(branchEntities, requested)
    if ('miss' in lookup) return null
    const [requestedRow, otherRow] = lookup.pair
    const flagged = flaggedSideOf(requestedRow, otherRow)
    if (flagged == null) return null
    const sides = collisionPair(requested, {
      branchEntities,
      branchHappenings: [...happeningRows.values()],
      branchAwareness: [...awarenessRows.values()],
      branchInvolvements: [...involvementRows.values()],
      branchRelationships: [...relationshipRows.values()],
      branchTranslations: [...translationRows.values()],
      story,
    })
    if (sides == null) return null
    const parentName = sharedParentName(flagged, branchEntities)
    return {
      sides,
      flaggedId: flagged.id,
      reason: flagged.nameCollisionReason,
      ...(parentName == null ? {} : { parentName }),
    }
  }, [
    requested,
    entityRows,
    happeningRows,
    awarenessRows,
    involvementRows,
    relationshipRows,
    translationRows,
    story,
  ])

  useEffect(() => {
    if (requested != null && pair == null) setRequested(null)
  }, [requested, pair, setRequested])

  // Only a character carries the flag (entities_lead_character) or a stamp, so no other pair reads.
  const readsHeld = pair?.sides[0].kind === 'character'
  const { status: stampStatus, data: stampedIds } = useQuery({
    queryKey: ['collision-held', branchId, requested?.[0] ?? null, requested?.[1] ?? null, openSeq],
    queryFn:
      requested == null || !readsHeld ? skipToken : () => readStamped(branchId, requested, ctx.db),
    // openSeq restarts per mount, so a remounted World would otherwise reuse the last one's read.
    gcTime: 0,
    retry: false,
  })

  const dialog = useMemo((): CollisionDialog | null => {
    if (pair == null || entityRows == null) return null
    if (!readsHeld) return { pair, heldIds: NONE_HELD }
    if (stampStatus !== 'success') return null
    const heldIds = pair.sides
      .map((side) => side.id)
      .filter((id) => entityRows.get(id)?.isLead === 1 || stampedIds.has(id))
    return { pair, heldIds }
  }, [pair, entityRows, readsHeld, stampStatus, stampedIds])

  // A failed read leaves no dialog to show the failure, so the request closes with a toast.
  useEffect(() => {
    if (requested == null || stampStatus !== 'error') return
    toast.error(t('world:collision.heldFailed'))
    setRequested(null)
  }, [requested, stampStatus, setRequested])

  const request = useCallback(
    (flaggedId: string, otherId: string) =>
      guard(() => {
        setOpenSeq((seq) => seq + 1)
        setRequested([flaggedId, otherId])
      }),
    [guard, setRequested],
  )
  const close = useCallback(() => setRequested(null), [setRequested])

  const resolve = useCallback(
    async (resolution: Resolution): Promise<void> => {
      if (pair == null) throw new Error(collisionRejectionText(COLLISION_REJECTION.notFound))
      const asked = requestedRef.current
      const refuse = (code: CollisionRejectionCode): never => {
        if (requestedRef.current !== asked) toast.error(CLOSED_REJECTION_TEXT[code]())
        throw new Error(collisionRejectionText(code))
      }
      const action = toCollisionResolution(resolution, pair.sides)
      let result: CollisionResolveResult
      try {
        result = await resolveCollision(branchId, action, ctx)
      } catch (error) {
        logger.error('app.world_collision_resolve_failed', {
          branchId,
          mode: resolution.mode,
          ids: pair.sides.map((side) => side.id),
          error: error instanceof Error ? error.message : String(error),
        })
        return refuse(COLLISION_REJECTION.failed)
      }
      if (result.status === 'rejected') return refuse(result.code)
      toast.success(resolvedText(action, pair.sides))
    },
    [pair, branchId, ctx],
  )

  return { dialog, request, close, resolve }
}

/** WorldListPane's `resolveCollision`: Resolve acts, or stays inert with the gate's reason. */
export function collisionResolveProp(
  disabledReason: string | undefined,
  onResolve: (id: string) => void,
): { onResolve: (id: string) => void } | { disabledReason: string } {
  return disabledReason == null ? { onResolve } : { disabledReason }
}
