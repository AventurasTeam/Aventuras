import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  SCALAR_FIELDS,
  type EntitySummary,
  type Resolution,
  type ScalarField,
} from '@/components/compounds/collision-resolve-diff'
import { gateDisabledReason } from '@/components/compounds/generation-gate-copy'
import {
  COLLISION_REJECTION,
  resolveCollision,
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
  translationsStore,
} from '@/lib/stores'
import { toast } from '@/lib/toast'
import { namesakeKey, type MergeScalar } from '@/lib/world'

import { collisionRejectionText } from './collision-copy'
import { collisionPair } from './collision-summary'

type Pair = readonly [EntitySummary, EntitySummary]

// The dialog's scalars and the merge's must be the same set; `fromLoser` alone checks one way.
type _ScalarsMatch = [ScalarField] extends [MergeScalar]
  ? [MergeScalar] extends [ScalarField]
    ? true
    : never
  : never
const _scalarsMatchCheck: [_ScalarsMatch] = [true]
void _scalarsMatchCheck

function inBranch<Row extends { branchId: string }>(
  rows: ReadonlyMap<string, Row>,
  branchId: string,
): Row[] {
  return [...rows.values()].filter((row) => row.branchId === branchId)
}

/** The dialog's resolution as the action takes it; `pair` is older first, as the dialog got it. */
function toCollisionResolution(resolution: Resolution, [a, b]: Pair): CollisionResolution {
  switch (resolution.mode) {
    case 'merge': {
      const canonicalIsA = resolution.canonicalId === a.id
      const loserSide = canonicalIsA ? 'B' : 'A'
      return {
        mode: 'merge',
        canonicalId: resolution.canonicalId,
        loserId: canonicalIsA ? b.id : a.id,
        fromLoser: SCALAR_FIELDS.filter((field) => resolution.fieldChoices[field] === loserSide),
        tags: resolution.finalTags,
        keywords: resolution.finalKeywords,
      }
    }
    case 'rename': {
      const nameOf = (side: EntitySummary) =>
        resolution.renames.find((rename) => rename.id === side.id)?.newName ?? side.name
      return { mode: 'rename', ids: [a.id, b.id], names: [nameOf(a), nameOf(b)] }
    }
    case 'keep':
      return { mode: 'keep', ids: [a.id, b.id] }
  }
}

function resolvedText(resolution: Resolution, pair: Pair): string {
  switch (resolution.mode) {
    case 'merge': {
      const canonical = pair.find((side) => side.id === resolution.canonicalId) ?? pair[0]
      return t('world:collision.resolved.merge', { name: canonical.name })
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
  const [requested, setRequested] = useState<readonly [string, string] | null>(null)
  const open = requested != null
  // Subscribed only while open, so a closed dialog doesn't re-render the route on every link patch.
  const entityRows = entitiesStore.useEntities((rows) => (open ? rows : null))
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
      awarenessRows == null ||
      involvementRows == null ||
      relationshipRows == null ||
      translationRows == null
    )
      return null
    const live = collisionPair(requested, {
      branchId,
      entities: inBranch(entityRows, branchId),
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
    awarenessRows,
    involvementRows,
    relationshipRows,
    translationRows,
  ])

  useEffect(() => {
    if (requested != null && pair == null) setRequested(null)
  }, [requested, pair])

  const request = useCallback(
    (flaggedId: string, otherId: string) => guard(() => setRequested([flaggedId, otherId])),
    [guard],
  )
  const close = useCallback(() => setRequested(null), [])

  const resolve = useCallback(
    async (resolution: Resolution): Promise<void> => {
      if (pair == null) throw new Error(collisionRejectionText(COLLISION_REJECTION.notFound))
      let result: CollisionResolveResult
      try {
        result = await resolveCollision(branchId, toCollisionResolution(resolution, pair), ctx)
      } catch (error) {
        logger.error('app.world_collision_resolve_failed', {
          branchId,
          mode: resolution.mode,
          ids: pair.map((side) => side.id),
          error: error instanceof Error ? error.message : String(error),
        })
        throw new Error(t('world:collision.failed'))
      }
      if (result.status === 'rejected') throw new Error(collisionRejectionText(result.code))
      toast.success(resolvedText(resolution, pair))
    },
    [pair, branchId, ctx],
  )

  return { pair, request, close, resolve }
}

/** WorldListPane's `resolveCollision`: Resolve acts, or stays inert with the gate's reason. */
export function collisionResolveProp(
  editBlocked: boolean,
  gateReason: string | undefined,
  onResolve: (id: string) => void,
): { onResolve: (id: string) => void } | { disabledReason: string } {
  const disabledReason = gateDisabledReason(editBlocked, gateReason)
  return disabledReason == null ? { onResolve } : { disabledReason }
}
