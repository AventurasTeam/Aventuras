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
import { namesakeKey } from '@/lib/world'

import { collisionRejectionText } from './collision-copy'
import { collisionPair } from './collision-summary'

type Pair = readonly [EntitySummary, EntitySummary]

// A toast lands after the dialog closed, so it can't tell the user to close it or pick a row in it.
const CLOSED_REJECTION_TEXT: Record<CollisionRejectionCode, () => string> = {
  [COLLISION_REJECTION.inFlight]: () => collisionRejectionText(COLLISION_REJECTION.inFlight),
  [COLLISION_REJECTION.notFound]: () => t('world:collision.closedRejection.notFound'),
  [COLLISION_REJECTION.leadEntity]: () => t('world:collision.closedRejection.leadEntity'),
  [COLLISION_REJECTION.parentCycle]: () => t('world:collision.closedRejection.parentCycle'),
  [COLLISION_REJECTION.parentChainBroken]: () =>
    collisionRejectionText(COLLISION_REJECTION.parentChainBroken),
  [COLLISION_REJECTION.invalidRename]: () =>
    collisionRejectionText(COLLISION_REJECTION.invalidRename),
  [COLLISION_REJECTION.failed]: () => collisionRejectionText(COLLISION_REJECTION.failed),
}

function inBranch<Row extends { branchId: string }>(
  rows: ReadonlyMap<string, Row>,
  branchId: string,
): Row[] {
  return [...rows.values()].filter((row) => row.branchId === branchId)
}

/** The dialog's resolution as the action takes it: the loser is the pair row that isn't canonical. */
function toCollisionResolution(resolution: Resolution, [a, b]: Pair): CollisionResolution {
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

function resolvedText(resolution: CollisionResolution, pair: Pair): string {
  switch (resolution.mode) {
    case 'merge': {
      const nameFrom = resolution.fromLoser.includes('name')
        ? resolution.loserId
        : resolution.canonicalId
      const name = pair.find((side) => side.id === nameFrom)?.name ?? pair[0].name
      return t('world:collision.resolved.merge', { name })
    }
    case 'rename':
      return t('world:collision.resolved.rename')
    case 'keep':
      return t('world:collision.resolved.keep')
  }
}

/**
 * world.md → Resolve dialog. The pair is read live while open and closes for good once its rows
 * stop colliding, so an undo that restores a merged-away row doesn't reopen the dialog.
 */
export function useCollisionResolve(
  branchId: string,
  ctx: DbCtx,
  guard: (proceed: () => void) => void,
): {
  pair: Pair | null
  request: (flaggedId: string, otherId: string) => void
  close: () => void
  resolve: (resolution: Resolution) => Promise<void>
} {
  const [requested, setRequestedState] = useState<readonly [string, string] | null>(null)
  // Read after the action settles: a request closed meanwhile has no dialog left to show an error.
  const requestedRef = useRef(requested)
  const setRequested = useCallback((next: readonly [string, string] | null) => {
    requestedRef.current = next
    setRequestedState(next)
  }, [])
  const open = requested != null
  // Subscribed only while open, so a closed dialog doesn't re-render the route on every link patch.
  const entityRows = entitiesStore.useEntities((rows) => (open ? rows : null))
  const happeningRows = happeningsStore.useHappenings((rows) => (open ? rows : null))
  const awarenessRows = happeningAwarenessStore.useAwareness((rows) => (open ? rows : null))
  const involvementRows = happeningInvolvementsStore.useInvolvements((rows) => (open ? rows : null))
  const relationshipRows = characterRelationshipsStore.useRelationships((rows) =>
    open ? rows : null,
  )
  const translationRows = translationsStore.useTranslations((rows) => (open ? rows : null))

  const pair = useMemo((): Pair | null => {
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
    const live = collisionPair(requested, {
      branchId,
      entities: inBranch(entityRows, branchId),
      happenings: inBranch(happeningRows, branchId),
      awareness: inBranch(awarenessRows, branchId),
      involvements: inBranch(involvementRows, branchId),
      relationships: inBranch(relationshipRows, branchId),
      translations: inBranch(translationRows, branchId),
    })
    return live != null && namesakeKey(live[0]) === namesakeKey(live[1]) ? live : null
  }, [
    requested,
    branchId,
    entityRows,
    happeningRows,
    awarenessRows,
    involvementRows,
    relationshipRows,
    translationRows,
  ])

  useEffect(() => {
    if (requested != null && pair == null) setRequested(null)
  }, [requested, pair, setRequested])

  const request = useCallback(
    (flaggedId: string, otherId: string) => guard(() => setRequested([flaggedId, otherId])),
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
      const action = toCollisionResolution(resolution, pair)
      let result: CollisionResolveResult
      try {
        result = await resolveCollision(branchId, action, ctx)
      } catch (error) {
        logger.error('app.world_collision_resolve_failed', {
          branchId,
          mode: resolution.mode,
          ids: pair.map((side) => side.id),
          error: error instanceof Error ? error.message : String(error),
        })
        return refuse(COLLISION_REJECTION.failed)
      }
      if (result.status === 'rejected') return refuse(result.code)
      toast.success(resolvedText(action, pair))
    },
    [pair, branchId, ctx],
  )

  return { pair, request, close, resolve }
}

/** WorldListPane's `resolveCollision`: Resolve acts, or stays inert with the gate's reason. */
export function collisionResolveProp(
  disabledReason: string | undefined,
  onResolve: (id: string) => void,
): { onResolve: (id: string) => void } | { disabledReason: string } {
  return disabledReason == null ? { onResolve } : { disabledReason }
}
