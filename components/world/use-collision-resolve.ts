import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
import { normalizeTerm } from '@/lib/keyword-terms'
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

/** Each term of the pair whose key the dialog's final list lacks: the user deselected it. */
function deselected(
  terms: readonly string[],
  final: readonly string[],
  keyOf: (term: string) => string,
): string[] {
  const kept = new Set(final.map(keyOf))
  return [...new Set(terms.map(keyOf))].filter((key) => key !== '' && !kept.has(key))
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
        deselectedTags: deselected([...a.tags, ...b.tags], resolution.finalTags, (tag) =>
          tag.trim(),
        ),
        deselectedKeywords: deselected(
          [...a.keywords, ...b.keywords],
          resolution.finalKeywords,
          normalizeTerm,
        ),
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
      const refuse = (text: string): never => {
        if (requestedRef.current !== asked) toast.error(text)
        throw new Error(text)
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
        return refuse(t('world:collision.failed'))
      }
      if (result.status === 'rejected') return refuse(collisionRejectionText(result.code))
      toast.success(resolvedText(action, pair))
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
