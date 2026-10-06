// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  computeDivergence,
  type EntitySummary,
  type Resolution,
  type ScalarField,
} from '@/components/compounds/collision-resolve-diff'
import { initMergeState, mergeReducer } from '@/components/compounds/collision-resolve-machine'
import { COLLISION_REJECTION, type DbCtx } from '@/lib/actions'
import { emptyEntityState, type HappeningAwareness, type Translation } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { makeEntity } from '@/lib/list-modules/__tests__/fixtures'
import {
  characterRelationshipsStore,
  entitiesStore,
  happeningAwarenessStore,
  happeningInvolvementsStore,
  translationsStore,
} from '@/lib/stores'
import { toast } from '@/lib/toast'

import { collisionResolveProp, useCollisionResolve } from './use-collision-resolve'

const resolveCollision = vi.hoisted(() => vi.fn())
vi.mock('@/lib/actions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveCollision,
}))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

type Pair = readonly [EntitySummary, EntitySummary]

const ctx = {} as DbCtx
const BRANCH = 'br_1'
const OLDER = makeEntity({
  id: 'char_brannoc',
  kind: 'character',
  name: 'Brannoc',
  description: 'A Watch sergeant with a debt to the Syndicate.',
  status: 'staged',
  tags: ['watch'],
  keywords: ['the sergeant'],
  state: emptyEntityState('character'),
  createdAt: 1_000,
})
const NEWER = makeEntity({
  id: 'char_brannoc_2',
  kind: 'character',
  name: 'Brannoc',
  description: 'A smuggler who runs the river gate after dark.',
  status: 'active',
  nameCollisionFlag: 1,
  tags: ['smuggler'],
  keywords: ['the river gate'],
  state: emptyEntityState('character'),
  createdAt: 2_000,
})
const TAGS = ['smuggler', 'watch']
const KEYWORDS = ['the river gate', 'the sergeant']
const LEAD_TEXT =
  "The story's lead can't be the row a merge removes. Pick it as the row that survives, or use Set as lead on another character first."
const IN_FLIGHT_TEXT = "Couldn't resolve while generation is in flight."
const FAILED_TEXT = "Couldn't resolve the collision."
const NOT_FOUND_TEXT =
  'These rows changed or no longer collide. Close this and check the list again.'

const run = (proceed: () => void) => proceed()

function awareness(id: string, characterId: string): HappeningAwareness {
  return {
    id,
    branchId: BRANCH,
    happeningId: 'hap_1',
    characterId,
    learnedAtEntryId: null,
    decayResistance: null,
    retrievalCount: 0,
    source: null,
  }
}

function translation(id: string, targetId: string): Translation {
  return {
    id,
    branchId: BRANCH,
    targetKind: 'entity',
    targetId,
    field: 'description',
    language: 'es',
    translatedText: 'Un contrabandista.',
    createdAt: 1,
    updatedAt: 1,
  }
}

// The flagged (newer) row asks, as the strip does; the pair must still come back older first.
function openPair(guard: (proceed: () => void) => void = run) {
  const { result } = renderHook(() => useCollisionResolve(BRANCH, ctx, guard))
  act(() => result.current.request(NEWER.id, OLDER.id))
  return result
}

function openedPair(result: { current: ReturnType<typeof useCollisionResolve> }): Pair {
  const pair = result.current.pair
  if (pair == null) throw new Error('expected an open pair')
  return pair
}

/** The `fieldChoices` the dialog's reducer holds for this canonical after `picks`. */
function fieldChoices(
  pair: Pair,
  canonicalId: string,
  picks: readonly (readonly [ScalarField, 'A' | 'B'])[],
) {
  let state = initMergeState(computeDivergence(pair[0], pair[1]), canonicalId, pair[0].id)
  for (const [field, side] of picks)
    state = mergeReducer(state, { type: 'pick-field', field, side })
  return state.fieldChoices
}

beforeEach(() => {
  entitiesStore.hydrate(BRANCH, [OLDER, NEWER])
  happeningAwarenessStore.hydrate(BRANCH, [])
  happeningInvolvementsStore.hydrate(BRANCH, [])
  characterRelationshipsStore.hydrate(BRANCH, [])
  translationsStore.hydrate(BRANCH, [])
  resolveCollision.mockReset()
  vi.mocked(toast.success).mockClear()
  vi.spyOn(logger, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  entitiesStore.__reset()
  happeningAwarenessStore.__reset()
  happeningInvolvementsStore.__reset()
  characterRelationshipsStore.__reset()
  translationsStore.__reset()
})

describe('useCollisionResolve → opening', () => {
  it('opens the pair only once the guard lets the request through, older row first', () => {
    let proceed: (() => void) | undefined
    const result = openPair((fn) => {
      proceed = fn
    })
    expect(result.current.pair).toBeNull()

    act(() => proceed?.())

    expect(result.current.pair?.map((side) => side.id)).toEqual([OLDER.id, NEWER.id])
  })

  it('does not re-render on store patches while no pair is open', () => {
    let renders = 0
    renderHook(() => {
      renders += 1
      return useCollisionResolve(BRANCH, ctx, run)
    })
    const settled = renders

    act(() => {
      happeningAwarenessStore.hydrate(BRANCH, [awareness('haw_1', NEWER.id)])
      entitiesStore.hydrate(BRANCH, [OLDER, { ...NEWER, description: 'Edited.' }])
    })

    expect(renders).toBe(settled)
  })

  it('re-derives the open pair when a link or translation row lands', () => {
    const result = openPair()
    expect(openedPair(result)[1].relationCounts.awarenessRows).toBe(0)
    expect(openedPair(result)[1].relationCounts.translationRows).toBe(0)

    act(() => {
      happeningAwarenessStore.hydrate(BRANCH, [awareness('haw_1', NEWER.id)])
      translationsStore.hydrate(BRANCH, [translation('tr_1', NEWER.id)])
    })

    expect(openedPair(result)[1].relationCounts.awarenessRows).toBe(1)
    expect(openedPair(result)[1].relationCounts.translationRows).toBe(1)
  })

  it('closes once a row of the pair is gone, and stays closed when an undo brings it back', () => {
    const result = openPair()

    act(() => entitiesStore.hydrate(BRANCH, [OLDER]))
    expect(result.current.pair).toBeNull()

    act(() => entitiesStore.hydrate(BRANCH, [OLDER, NEWER]))
    expect(result.current.pair).toBeNull()
  })

  it('closes once the two rows stop being namesakes', () => {
    const result = openPair()
    act(() =>
      entitiesStore.hydrate(BRANCH, [OLDER, { ...NEWER, name: 'Brannoc of the river gate' }]),
    )
    expect(result.current.pair).toBeNull()
  })

  it('stays open across a case-only rename, which still collides', () => {
    const result = openPair()
    act(() => entitiesStore.hydrate(BRANCH, [OLDER, { ...NEWER, name: 'BRANNOC' }]))
    expect(result.current.pair?.[1].name).toBe('BRANNOC')
  })

  it('close() drops the open pair', () => {
    const result = openPair()
    act(() => result.current.close())
    expect(result.current.pair).toBeNull()
  })
})

describe('useCollisionResolve → what resolve sends', () => {
  beforeEach(() => {
    resolveCollision.mockResolvedValue({ status: 'ok' })
  })

  it('maps a merge into the older row: the newer row loses, and only its picked scalars come over', async () => {
    const result = openPair()
    const pair = openedPair(result)

    await result.current.resolve({
      mode: 'merge',
      canonicalId: OLDER.id,
      fieldChoices: fieldChoices(pair, OLDER.id, [['status', 'B']]),
      finalTags: TAGS,
      finalKeywords: KEYWORDS,
    })

    expect(resolveCollision).toHaveBeenCalledWith(
      BRANCH,
      {
        mode: 'merge',
        canonicalId: OLDER.id,
        loserId: NEWER.id,
        fromLoser: ['status'],
        tags: TAGS,
        keywords: KEYWORDS,
      },
      ctx,
    )
    expect(toast.success).toHaveBeenCalledWith('Merged into Brannoc.')
  })

  it('maps a merge into the newer row: the older row loses, and its side is A', async () => {
    const result = openPair()
    const pair = openedPair(result)

    await result.current.resolve({
      mode: 'merge',
      canonicalId: NEWER.id,
      fieldChoices: fieldChoices(pair, NEWER.id, [['description', 'A']]),
      finalTags: TAGS,
      finalKeywords: KEYWORDS,
    })

    expect(resolveCollision).toHaveBeenCalledWith(
      BRANCH,
      {
        mode: 'merge',
        canonicalId: NEWER.id,
        loserId: OLDER.id,
        fromLoser: ['description'],
        tags: TAGS,
        keywords: KEYWORDS,
      },
      ctx,
    )
  })

  it('maps a rename to both names in pair order, an untouched one as its current name', async () => {
    const result = openPair()
    const rename: Resolution = {
      mode: 'rename',
      renames: [{ id: NEWER.id, newName: 'Brannoc of the river gate' }],
    }

    await result.current.resolve(rename)

    expect(resolveCollision).toHaveBeenCalledWith(
      BRANCH,
      {
        mode: 'rename',
        ids: [OLDER.id, NEWER.id],
        names: ['Brannoc', 'Brannoc of the river gate'],
      },
      ctx,
    )
    expect(toast.success).toHaveBeenCalledWith('Names saved.')
  })

  it('maps keep to the pair ids, older first', async () => {
    const result = openPair()

    await result.current.resolve({ mode: 'keep' })

    expect(resolveCollision).toHaveBeenCalledWith(
      BRANCH,
      { mode: 'keep', ids: [OLDER.id, NEWER.id] },
      ctx,
    )
  })
})

describe('useCollisionResolve → outcomes', () => {
  it('toasts the resolution once the action commits', async () => {
    resolveCollision.mockResolvedValue({ status: 'ok' })
    const result = openPair()

    await expect(result.current.resolve({ mode: 'keep' })).resolves.toBeUndefined()

    expect(toast.success).toHaveBeenCalledWith('Kept as distinct.')
  })

  it('rejects with the lead text when the merge would remove the lead, and toasts nothing', async () => {
    resolveCollision.mockResolvedValue({
      status: 'rejected',
      reason: 'lead entity',
      code: COLLISION_REJECTION.leadEntity,
    })
    const result = openPair()
    const pair = openedPair(result)

    await expect(
      result.current.resolve({
        mode: 'merge',
        canonicalId: NEWER.id,
        fieldChoices: fieldChoices(pair, NEWER.id, []),
        finalTags: TAGS,
        finalKeywords: KEYWORDS,
      }),
    ).rejects.toThrow(LEAD_TEXT)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('rejects with the in-flight text when a turn started meanwhile', async () => {
    resolveCollision.mockResolvedValue({
      status: 'rejected',
      reason: 'generation in flight',
      code: COLLISION_REJECTION.inFlight,
    })
    const result = openPair()

    await expect(result.current.resolve({ mode: 'keep' })).rejects.toThrow(IN_FLIGHT_TEXT)
  })

  it('logs an action that threw and rejects with the generic failure', async () => {
    resolveCollision.mockRejectedValue(new Error('SQLITE_BUSY: database is locked'))
    const result = openPair()

    await expect(result.current.resolve({ mode: 'keep' })).rejects.toThrow(FAILED_TEXT)
    expect(logger.error).toHaveBeenCalledWith(
      'app.world_collision_resolve_failed',
      expect.objectContaining({
        branchId: BRANCH,
        mode: 'keep',
        error: 'SQLITE_BUSY: database is locked',
      }),
    )
  })

  it('refuses without calling the action once the pair is gone', async () => {
    const result = openPair()
    act(() => entitiesStore.hydrate(BRANCH, [OLDER]))

    await expect(result.current.resolve({ mode: 'keep' })).rejects.toThrow(NOT_FOUND_TEXT)
    expect(resolveCollision).not.toHaveBeenCalled()
  })
})

describe('collisionResolveProp', () => {
  const onResolve = () => {}

  it('passes the handler through while writes are open', () => {
    expect(collisionResolveProp(false, undefined, onResolve)).toStrictEqual({ onResolve })
  })

  it("disables Resolve with the gate's own reason during a turn", () => {
    expect(
      collisionResolveProp(true, 'Chapter close in progress. Cancel to edit.', onResolve),
    ).toStrictEqual({ disabledReason: 'Chapter close in progress. Cancel to edit.' })
  })

  it('falls back to the in-flight text when the gate gives no reason', () => {
    expect(collisionResolveProp(true, undefined, onResolve)).toStrictEqual({
      disabledReason: 'Generation is in flight. Cancel to edit.',
    })
  })
})
