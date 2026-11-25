// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type Resolution } from '@/components/compounds/collision-resolve-diff'
import { COLLISION_REJECTION, type DbCtx } from '@/lib/actions'
import { createQueryClient } from '@/lib/cache'
import {
  emptyEntityState,
  type CharacterRelationship,
  type CollisionReason,
  type Entity,
  type EntityKind,
  type Happening,
  type HappeningAwareness,
  type HappeningInvolvement,
  type Translation,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { makeEntity } from '@/lib/list-modules/__tests__/fixtures'
import {
  characterRelationshipsStore,
  entitiesStore,
  happeningAwarenessStore,
  happeningInvolvementsStore,
  happeningsStore,
  translationsStore,
} from '@/lib/stores'
import { toast } from '@/lib/toast'
import { storyPlaceOf, type StoryPlace } from '@/lib/world'

import {
  collisionResolveProp,
  useCollisionResolve,
  type CollisionDialog,
  type CollisionDialogPair,
} from './use-collision-resolve'

const resolveCollision = vi.hoisted(() => vi.fn())
const readStampedLeadIds = vi.hoisted(() => vi.fn())
const NOWHERE = storyPlaceOf({ tail: null, sceneSource: null })

vi.mock('@/lib/actions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveCollision,
}))
vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readStampedLeadIds,
}))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const DB = {} as DbCtx['db']
const ctx = { db: DB } as DbCtx
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
  nameCollisionPartnerId: 'char_brannoc',
  nameCollisionReason: 'distinct',
  tags: ['smuggler'],
  keywords: ['the river gate'],
  state: emptyEntityState('character'),
  createdAt: 2_000,
})
const UNFLAGGED = {
  nameCollisionFlag: 0,
  nameCollisionPartnerId: null,
  nameCollisionReason: null,
} as const
// Two rows can name each other, as a merge's re-point can leave them.
const OLDER_NAMING_NEWER: Entity = {
  ...OLDER,
  nameCollisionFlag: 1,
  nameCollisionPartnerId: NEWER.id,
  nameCollisionReason: 'alike',
}
const LEAD_TEXT =
  "The row this merge would remove is or was this branch's lead, so it stays. Close this and open the pair again to see which row survives."
const HELD_FAILED_TEXT =
  "Couldn't open this collision: checking whether either row is or was this branch's lead failed."
const IN_FLIGHT_TEXT = "Couldn't resolve while generation is in flight."
const FAILED_TEXT = "Couldn't resolve the collision."
const NOT_FOUND_TEXT =
  'These rows changed or no longer collide. Close this and check the list again.'

const run = (proceed: () => void) => proceed()

// A client per hook, so no test sees another's cached read.
function queries(): { wrapper: (props: { children: ReactNode }) => ReactElement } {
  const client = createQueryClient()
  return {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  }
}

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

function involvement(id: string, entityId: string): HappeningInvolvement {
  return { id, branchId: BRANCH, happeningId: 'hap_1', entityId, role: null }
}

function relationship(id: string, aId: string, bId: string): CharacterRelationship {
  return {
    id,
    branchId: BRANCH,
    aId,
    bId,
    kind: 'rival',
    inverseKind: null,
    createdAt: 1,
    updatedAt: 1,
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
  const { result } = renderHook(() => useCollisionResolve(BRANCH, ctx, guard, NOWHERE), queries())
  act(() => result.current.request(NEWER.id, OLDER.id))
  return result
}

async function openReady(stamped: ReadonlySet<string> = new Set()) {
  readStampedLeadIds.mockResolvedValueOnce(stamped)
  const result = openPair()
  await waitFor(() => expect(result.current.dialog).not.toBeNull())
  return result
}

function openedPair(result: {
  current: ReturnType<typeof useCollisionResolve>
}): CollisionDialogPair {
  const pair = result.current.dialog?.pair
  if (pair == null) throw new Error('expected an open pair')
  return pair
}

const HAPPENING: Happening = {
  id: 'hap_1',
  branchId: BRANCH,
  title: 'Fire',
  description: null,
  category: null,
  icon: null,
  temporal: null,
  occurredAtEntryId: null,
  commonKnowledge: 1,
  embeddingStale: 0,
  createdAt: 1,
  updatedAt: 1,
}

beforeEach(() => {
  entitiesStore.hydrate(BRANCH, [OLDER, NEWER])
  happeningsStore.hydrate(BRANCH, [HAPPENING])
  happeningAwarenessStore.hydrate(BRANCH, [])
  happeningInvolvementsStore.hydrate(BRANCH, [])
  characterRelationshipsStore.hydrate(BRANCH, [])
  translationsStore.hydrate(BRANCH, [])
  resolveCollision.mockReset()
  readStampedLeadIds.mockReset()
  // Pending by default: the tests that read held rows settle their own.
  readStampedLeadIds.mockReturnValue(new Promise<never>(() => {}))
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
  vi.spyOn(logger, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  entitiesStore.__reset()
  happeningsStore.__reset()
  happeningAwarenessStore.__reset()
  happeningInvolvementsStore.__reset()
  characterRelationshipsStore.__reset()
  translationsStore.__reset()
})

describe('useCollisionResolve → opening', () => {
  it('opens the pair only once the guard lets the request through, older row first', async () => {
    readStampedLeadIds.mockResolvedValueOnce(new Set())
    let proceed: (() => void) | undefined
    const result = openPair((fn) => {
      proceed = fn
    })
    expect(result.current.dialog).toBeNull()
    expect(readStampedLeadIds).not.toHaveBeenCalled()

    act(() => proceed?.())

    await waitFor(() => expect(result.current.dialog).not.toBeNull())
    expect(openedPair(result).sides.map((side) => side.id)).toEqual([OLDER.id, NEWER.id])
    expect(openedPair(result)).toMatchObject({ flaggedId: NEWER.id, reason: 'distinct' })
  })

  // A fork copies the pair under its ids; the dialog reads the route's branch only.
  it('opens no pair while the entities store holds another branch', () => {
    entitiesStore.hydrate('br_2', [
      { ...OLDER, branchId: 'br_2' },
      { ...NEWER, branchId: 'br_2' },
    ])
    expect(openPair().current.dialog).toBeNull()
    expect(readStampedLeadIds).not.toHaveBeenCalled()
  })

  it('does not re-render on store patches while no pair is open', () => {
    let renders = 0
    renderHook(() => {
      renders += 1
      return useCollisionResolve(BRANCH, ctx, run, NOWHERE)
    }, queries())
    const settled = renders

    act(() => {
      happeningAwarenessStore.hydrate(BRANCH, [awareness('haw_1', NEWER.id)])
      happeningInvolvementsStore.hydrate(BRANCH, [involvement('hin_1', NEWER.id)])
      characterRelationshipsStore.hydrate(BRANCH, [relationship('rel_1', OLDER.id, NEWER.id)])
      translationsStore.hydrate(BRANCH, [translation('tr_1', NEWER.id)])
      entitiesStore.hydrate(BRANCH, [OLDER, { ...NEWER, description: 'Edited.' }])
    })

    expect(renders).toBe(settled)
  })

  it('re-derives the open pair when a link or translation row lands', async () => {
    const result = await openReady()
    expect(openedPair(result).sides[1].relationCounts.awarenessRows).toBe(0)
    expect(openedPair(result).sides[1].relationCounts.translationRows).toBe(0)

    act(() => {
      happeningAwarenessStore.hydrate(BRANCH, [awareness('haw_1', NEWER.id)])
      translationsStore.hydrate(BRANCH, [translation('tr_1', NEWER.id)])
    })

    expect(openedPair(result).sides[1].relationCounts.awarenessRows).toBe(1)
    expect(openedPair(result).sides[1].relationCounts.translationRows).toBe(1)
  })

  // Rebuilt in place, the story keeps its identity in useStoryPlace, which owns that stability.
  it('re-derives the open pair once the story moves', async () => {
    readStampedLeadIds.mockResolvedValueOnce(new Set())
    const { result, rerender } = renderHook(
      ({ story }: { story: StoryPlace }) => useCollisionResolve(BRANCH, ctx, run, story),
      { initialProps: { story: NOWHERE }, ...queries() },
    )
    act(() => result.current.request(NEWER.id, OLDER.id))
    await waitFor(() => expect(result.current.dialog).not.toBeNull())
    const opened = openedPair(result)

    const at = { metadata: { currentLocationId: 'loc_harbor' } }
    rerender({ story: storyPlaceOf({ tail: at, sceneSource: null }) })
    const tailMoved = openedPair(result)
    expect(tailMoved).not.toBe(opened)

    rerender({ story: storyPlaceOf({ tail: at, sceneSource: at }) })
    expect(openedPair(result)).not.toBe(tailMoved)
  })

  it('passes the story to the summary: an unplaced canonical holding it stays unplaced under a disabled place', () => {
    const harbor = makeEntity({
      id: 'loc_harbor',
      kind: 'location',
      name: 'Harbor',
      state: { parent_location_id: null, unplaced: true },
      createdAt: 1_000,
    })
    const dark = makeEntity({
      id: 'loc_dark',
      kind: 'location',
      name: 'Dark Wing',
      injectionMode: 'disabled',
      state: { parent_location_id: null },
    })
    const twin = makeEntity({
      id: 'loc_harbor_2',
      kind: 'location',
      name: 'Harbor',
      state: { parent_location_id: 'loc_dark' },
      nameCollisionFlag: 1,
      nameCollisionPartnerId: harbor.id,
      nameCollisionReason: 'alike',
      createdAt: 2_000,
    })
    act(() => entitiesStore.hydrate(BRANCH, [harbor, dark, twin]))
    const placementWith = (story: StoryPlace) => {
      const { result } = renderHook(() => useCollisionResolve(BRANCH, ctx, run, story), queries())
      act(() => result.current.request(twin.id, harbor.id))
      return openedPair(result).sides[1].relationCounts.overlap.canonicalPlacement
    }

    expect(placementWith(NOWHERE)).toBe('takes-loser')
    expect(
      placementWith(
        storyPlaceOf({
          tail: { metadata: { currentLocationId: harbor.id } },
          sceneSource: { metadata: { currentLocationId: harbor.id } },
        }),
      ),
    ).toBe('stays-unplaced')
  })

  it('closes once a row of the pair is gone, and stays closed when an undo brings it back', async () => {
    const result = await openReady()

    act(() => entitiesStore.hydrate(BRANCH, [OLDER]))
    expect(result.current.dialog).toBeNull()

    act(() => entitiesStore.hydrate(BRANCH, [OLDER, NEWER]))
    expect(result.current.dialog).toBeNull()
  })

  it('closes once the flag is cleared elsewhere, and stays closed when an undo re-flags it', async () => {
    const result = await openReady()

    act(() => entitiesStore.hydrate(BRANCH, [OLDER, { ...NEWER, ...UNFLAGGED }]))
    expect(result.current.dialog).toBeNull()

    act(() => entitiesStore.hydrate(BRANCH, [OLDER, NEWER]))
    expect(result.current.dialog).toBeNull()
  })

  it('stays open on a rename that keeps the flag', async () => {
    const result = await openReady()
    act(() =>
      entitiesStore.hydrate(BRANCH, [OLDER, { ...NEWER, name: 'Brannoc of the river gate' }]),
    )
    expect(openedPair(result).sides[1].name).toBe('Brannoc of the river gate')
    expect(openedPair(result)).toMatchObject({ flaggedId: NEWER.id, reason: 'distinct' })
  })

  it('reads the flag from the requested row when both rows name each other', async () => {
    entitiesStore.hydrate(BRANCH, [OLDER_NAMING_NEWER, NEWER])
    const result = await openReady()
    expect(openedPair(result)).toMatchObject({ flaggedId: NEWER.id, reason: 'distinct' })
  })

  it('takes the flag and reason from the other row once only it names the pair', async () => {
    entitiesStore.hydrate(BRANCH, [OLDER_NAMING_NEWER, NEWER])
    const result = await openReady()

    act(() => entitiesStore.hydrate(BRANCH, [OLDER_NAMING_NEWER, { ...NEWER, ...UNFLAGGED }]))

    expect(openedPair(result).sides.map((side) => side.id)).toEqual([OLDER.id, NEWER.id])
    expect(openedPair(result)).toMatchObject({ flaggedId: OLDER.id, reason: 'alike' })
  })

  it('never opens two rows of different kinds, even when a flag names the other', () => {
    const harbor = makeEntity({
      id: 'loc_harbor',
      kind: 'location',
      name: 'Brannoc',
      state: emptyEntityState('location'),
      createdAt: 500,
    })
    entitiesStore.hydrate(BRANCH, [OLDER, harbor, { ...NEWER, nameCollisionPartnerId: harbor.id }])
    const { result } = renderHook(() => useCollisionResolve(BRANCH, ctx, run, NOWHERE), queries())

    act(() => result.current.request(NEWER.id, harbor.id))

    expect(result.current.dialog).toBeNull()
    expect(readStampedLeadIds).not.toHaveBeenCalled()
  })

  it('close() drops the open pair', async () => {
    const result = await openReady()
    act(() => result.current.close())
    expect(result.current.dialog).toBeNull()
  })
})

describe('useCollisionResolve → the shared parent', () => {
  const place = (id: string, name: string, parentId: string | null, over: Partial<Entity> = {}) =>
    makeEntity({ id, kind: 'location', name, state: { parent_location_id: parentId }, ...over })
  const HOLLOW = place('loc_hollow', 'Veil’s Hollow', null, { createdAt: 100 })
  const marketUnder = (parentId: string | null) =>
    place('loc_market', 'The Drowned Market', parentId, { createdAt: 1_000 })
  const stallsUnder = (parentId: string | null, reason: CollisionReason = 'same-parent') =>
    place('loc_stalls', 'The Drowned Market Stalls', parentId, {
      createdAt: 2_000,
      nameCollisionFlag: 1,
      nameCollisionPartnerId: 'loc_market',
      nameCollisionReason: reason,
    })

  // The strip asks from the flagged (newer) row.
  function openPlaces(rows: Entity[]): CollisionDialogPair {
    entitiesStore.hydrate(BRANCH, rows)
    const { result } = renderHook(() => useCollisionResolve(BRANCH, ctx, run, NOWHERE), queries())
    act(() => result.current.request('loc_stalls', 'loc_market'))
    return openedPair(result)
  }

  it('names the parent a same-parent pair shares', () => {
    expect(
      openPlaces([HOLLOW, marketUnder('loc_hollow'), stallsUnder('loc_hollow')]),
    ).toMatchObject({ flaggedId: 'loc_stalls', reason: 'same-parent', parentName: 'Veil’s Hollow' })
  })

  it('names no parent for a same-parent pair at the root', () => {
    const pair = openPlaces([HOLLOW, marketUnder(null), stallsUnder(null)])
    expect(pair.reason).toBe('same-parent')
    expect(pair).not.toHaveProperty('parentName')
  })

  it('names no parent when the shared parent is no row on the branch', () => {
    const pair = openPlaces([marketUnder('loc_gone'), stallsUnder('loc_gone')])
    expect(pair.reason).toBe('same-parent')
    expect(pair).not.toHaveProperty('parentName')
  })

  it('names no parent for another reason, even under one', () => {
    const pair = openPlaces([
      HOLLOW,
      marketUnder('loc_hollow'),
      stallsUnder('loc_hollow', 'distinct'),
    ])
    expect(pair.reason).toBe('distinct')
    expect(pair).not.toHaveProperty('parentName')
  })
})

describe('useCollisionResolve → what resolve sends', () => {
  beforeEach(() => {
    resolveCollision.mockResolvedValue({ status: 'ok' })
  })

  it('maps a merge into the older row: the newer row loses, and only its picked scalars come over', async () => {
    const result = openPair()

    await result.current.resolve({
      mode: 'merge',
      canonicalId: OLDER.id,
      fromOther: ['status'],
      deselectedTags: [],
      deselectedKeywords: [],
    })

    expect(resolveCollision).toHaveBeenCalledWith(
      BRANCH,
      {
        mode: 'merge',
        canonicalId: OLDER.id,
        loserId: NEWER.id,
        fromLoser: ['status'],
        deselectedTags: [],
        deselectedKeywords: [],
      },
      ctx,
    )
    expect(toast.success).toHaveBeenCalledWith('Merged into Brannoc.')
  })

  it('maps a merge into the newer row: the older row loses, and its picked scalars come over', async () => {
    entitiesStore.hydrate(BRANCH, [OLDER, { ...NEWER, name: 'BRANNOC' }])
    const result = openPair()

    await result.current.resolve({
      mode: 'merge',
      canonicalId: NEWER.id,
      fromOther: ['description'],
      deselectedTags: [],
      deselectedKeywords: [],
    })

    expect(resolveCollision).toHaveBeenCalledWith(
      BRANCH,
      {
        mode: 'merge',
        canonicalId: NEWER.id,
        loserId: OLDER.id,
        fromLoser: ['description'],
        deselectedTags: [],
        deselectedKeywords: [],
      },
      ctx,
    )
    expect(toast.success).toHaveBeenCalledWith('Merged into BRANNOC.')
  })

  it('passes the deselected terms through as the dialog sent them', async () => {
    const result = openPair()

    await result.current.resolve({
      mode: 'merge',
      canonicalId: OLDER.id,
      fromOther: [],
      deselectedTags: ['smuggler'],
      deselectedKeywords: ['the sergeant'],
    })

    expect(resolveCollision).toHaveBeenCalledWith(
      BRANCH,
      expect.objectContaining({
        deselectedTags: ['smuggler'],
        deselectedKeywords: ['the sergeant'],
      }),
      ctx,
    )
  })

  it("names the merged row by the loser's name when the merge takes it", async () => {
    entitiesStore.hydrate(BRANCH, [OLDER, { ...NEWER, name: 'BRANNOC' }])
    const result = openPair()

    await result.current.resolve({
      mode: 'merge',
      canonicalId: NEWER.id,
      fromOther: ['name'],
      deselectedTags: [],
      deselectedKeywords: [],
    })

    expect(resolveCollision).toHaveBeenCalledWith(
      BRANCH,
      expect.objectContaining({ fromLoser: ['name'] }),
      ctx,
    )
    expect(toast.success).toHaveBeenCalledWith('Merged into Brannoc.')
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
        renames: [
          { id: OLDER.id, name: 'Brannoc' },
          { id: NEWER.id, name: 'Brannoc of the river gate' },
        ],
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

  it('rejects with the held-row text when the merge would remove a held row, and toasts nothing', async () => {
    resolveCollision.mockResolvedValue({
      status: 'rejected',
      reason: 'lead entity',
      code: COLLISION_REJECTION.leadEntity,
    })
    const result = openPair()

    await expect(
      result.current.resolve({
        mode: 'merge',
        canonicalId: NEWER.id,
        fromOther: [],
        deselectedTags: [],
        deselectedKeywords: [],
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
        ids: [OLDER.id, NEWER.id],
        error: 'SQLITE_BUSY: database is locked',
      }),
    )
  })

  it('toasts a refusal that lands after the dialog was closed, since no dialog is left to show it', async () => {
    let settle: (result: unknown) => void = () => {}
    resolveCollision.mockReturnValue(new Promise((resolve) => (settle = resolve)))
    const result = openPair()

    const pending = result.current.resolve({ mode: 'keep' })
    act(() => result.current.close())
    settle({
      status: 'rejected',
      reason: 'generation in flight',
      code: COLLISION_REJECTION.inFlight,
    })

    await expect(pending).rejects.toThrow(IN_FLIGHT_TEXT)
    expect(toast.error).toHaveBeenCalledWith(IN_FLIGHT_TEXT)
  })

  it('toasts a failure that lands after the dialog was closed', async () => {
    let fail: (error: Error) => void = () => {}
    resolveCollision.mockReturnValue(new Promise((_, reject) => (fail = reject)))
    const result = openPair()

    const pending = result.current.resolve({ mode: 'keep' })
    act(() => result.current.close())
    fail(new Error('SQLITE_BUSY: database is locked'))

    await expect(pending).rejects.toThrow(FAILED_TEXT)
    expect(toast.error).toHaveBeenCalledWith(FAILED_TEXT)
  })

  it('toasts a refusal that lands after the pair went away, which unmounts the dialog', async () => {
    let settle: (result: unknown) => void = () => {}
    resolveCollision.mockReturnValue(new Promise((resolve) => (settle = resolve)))
    const result = await openReady()

    const pending = result.current.resolve({ mode: 'keep' })
    act(() => entitiesStore.hydrate(BRANCH, [OLDER]))
    expect(result.current.dialog).toBeNull()
    settle({ status: 'rejected', reason: 'not found', code: COLLISION_REJECTION.notFound })

    await expect(pending).rejects.toThrow(NOT_FOUND_TEXT)
    // The dialog's copy says to close it and recheck; the toast can't point at a closed dialog.
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't resolve the collision: the rows changed or no longer collide.",
    )
  })

  it.each([
    [
      COLLISION_REJECTION.leadEntity,
      LEAD_TEXT,
      "Couldn't merge: the row it would remove is or was this branch's lead.",
    ],
    [
      COLLISION_REJECTION.parentCycle,
      'Merging these would make a location part of itself. Pick the other row to survive.',
      "Couldn't merge: it would make a location part of itself.",
    ],
    [
      COLLISION_REJECTION.storyInside,
      'The story is in one of these places, and the merge would retire it or move it into a disabled place. Change the status or mode the merge keeps, or pick the other row to survive.',
      "Couldn't merge: the story is in one of those places.",
    ],
    [
      COLLISION_REJECTION.placesInside,
      "A place inside one of these isn't retired, so the merged place can't be retired. Retire those places first, or keep the merged place active.",
      "Couldn't merge: a place inside one of them isn't retired.",
    ],
    [
      COLLISION_REJECTION.retiredParent,
      "The merged place's parent is retired, so the merged place can't be active or staged. Bring the parent back first, or keep it retired.",
      "Couldn't merge: the merged place's parent is retired.",
    ],
  ])(
    "toasts a %s refusal after close without the dialog's instruction",
    async (code, dialogText, toastText) => {
      let settle: (result: unknown) => void = () => {}
      resolveCollision.mockReturnValue(new Promise((resolve) => (settle = resolve)))
      const result = openPair()

      const pending = result.current.resolve({
        mode: 'merge',
        canonicalId: OLDER.id,
        fromOther: [],
        deselectedTags: [],
        deselectedKeywords: [],
      })
      act(() => result.current.close())
      settle({ status: 'rejected', reason: code, code })

      await expect(pending).rejects.toThrow(dialogText)
      expect(toast.error).toHaveBeenCalledWith(toastText)
    },
  )

  it('leaves a refusal to the open dialog, without a toast', async () => {
    resolveCollision.mockResolvedValue({
      status: 'rejected',
      reason: 'generation in flight',
      code: COLLISION_REJECTION.inFlight,
    })
    const result = openPair()

    await expect(result.current.resolve({ mode: 'keep' })).rejects.toThrow(IN_FLIGHT_TEXT)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('refuses without calling the action once the pair is gone', async () => {
    const result = openPair()
    act(() => entitiesStore.hydrate(BRANCH, [OLDER]))

    await expect(result.current.resolve({ mode: 'keep' })).rejects.toThrow(NOT_FOUND_TEXT)
    expect(resolveCollision).not.toHaveBeenCalled()
  })
})

describe('useCollisionResolve → held rows', () => {
  it('reads nothing and opens nothing while no pair is requested', async () => {
    const { result } = renderHook(() => useCollisionResolve(BRANCH, ctx, run, NOWHERE), queries())
    await act(async () => {})

    expect(result.current.dialog).toBeNull()
    expect(readStampedLeadIds).not.toHaveBeenCalled()
  })

  it('opens no dialog while the stamp read runs, then opens it with the held rows', async () => {
    let settle: (ids: ReadonlySet<string>) => void = () => {}
    readStampedLeadIds.mockReturnValueOnce(new Promise((resolve) => (settle = resolve)))
    const result = openPair()

    await waitFor(() =>
      expect(readStampedLeadIds).toHaveBeenCalledWith(BRANCH, [NEWER.id, OLDER.id], DB),
    )
    expect(result.current.dialog).toBeNull()

    settle(new Set([NEWER.id]))
    await waitFor(() => expect(result.current.dialog?.heldIds).toEqual([NEWER.id]))
    expect(openedPair(result).sides.map((side) => side.id)).toEqual([OLDER.id, NEWER.id])
  })

  it.each<[string, Entity[], ReadonlySet<string>, string[]]>([
    ['the older row by its flag', [{ ...OLDER, isLead: 1 }, NEWER], new Set(), [OLDER.id]],
    ['the newer row by its flag', [OLDER, { ...NEWER, isLead: 1 }], new Set(), [NEWER.id]],
    ['the newer row by a stamp', [OLDER, NEWER], new Set([NEWER.id]), [NEWER.id]],
    ['the older row by a stamp', [OLDER, NEWER], new Set([OLDER.id]), [OLDER.id]],
    [
      'both rows, one flagged and one stamped',
      [{ ...OLDER, isLead: 1 }, NEWER],
      new Set([NEWER.id]),
      [OLDER.id, NEWER.id],
    ],
    [
      'a row flagged and stamped, once',
      [{ ...OLDER, isLead: 1 }, NEWER],
      new Set([OLDER.id]),
      [OLDER.id],
    ],
    ['neither row', [OLDER, NEWER], new Set(), []],
  ])('marks %s as held', async (_, rows, stamped, held) => {
    entitiesStore.hydrate(BRANCH, rows)
    readStampedLeadIds.mockResolvedValueOnce(stamped)
    const result = openPair()

    await waitFor(() => expect(result.current.dialog?.heldIds).toEqual(held))
  })

  it.each<EntityKind>(['location', 'item', 'faction'])(
    'opens a pair of %ss at once holding nothing, with no read: only a character is held',
    async (kind) => {
      readStampedLeadIds.mockRejectedValue(new Error('SQLITE_BUSY: database is locked'))
      const first = makeEntity({
        id: `${kind}_harbor`,
        kind,
        name: 'Harbor',
        state: emptyEntityState(kind),
        createdAt: 1_000,
      })
      const second = makeEntity({
        id: `${kind}_harbor_2`,
        kind,
        name: 'Harbor',
        state: emptyEntityState(kind),
        nameCollisionFlag: 1,
        nameCollisionPartnerId: first.id,
        nameCollisionReason: 'alike',
        createdAt: 2_000,
      })
      entitiesStore.hydrate(BRANCH, [first, second])
      const { result } = renderHook(() => useCollisionResolve(BRANCH, ctx, run, NOWHERE), queries())

      act(() => result.current.request(second.id, first.id))

      expect(result.current.dialog).toMatchObject({ heldIds: [] })
      await act(async () => {})
      expect(readStampedLeadIds).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    },
  )

  it('takes a flag set while open into held without reading again', async () => {
    const result = await openReady()
    expect(result.current.dialog?.heldIds).toEqual([])

    act(() => entitiesStore.hydrate(BRANCH, [OLDER, { ...NEWER, isLead: 1 }]))

    expect(result.current.dialog?.heldIds).toEqual([NEWER.id])
    expect(readStampedLeadIds).toHaveBeenCalledTimes(1)
  })

  it("reads again on a reopen of the same pair, never showing the last open's held rows", async () => {
    const result = await openReady()
    expect(result.current.dialog?.heldIds).toEqual([])
    act(() => result.current.close())

    let settle: (ids: ReadonlySet<string>) => void = () => {}
    readStampedLeadIds.mockReturnValueOnce(new Promise((resolve) => (settle = resolve)))
    act(() => result.current.request(NEWER.id, OLDER.id))

    expect(result.current.dialog).toBeNull()
    settle(new Set([NEWER.id]))
    // React Query notifies on its own scheduler tick, so wait rather than read once.
    await waitFor(() => expect(result.current.dialog?.heldIds).toEqual([NEWER.id]))
    expect(readStampedLeadIds).toHaveBeenCalledTimes(2)
  })

  // Each mount counts its opens from zero, so its first open shares the last mount's query key.
  it('reads again in a World mounted after the last one closed', async () => {
    const shared = queries()
    readStampedLeadIds.mockResolvedValueOnce(new Set())
    const first = renderHook(() => useCollisionResolve(BRANCH, ctx, run, NOWHERE), shared)
    act(() => first.result.current.request(NEWER.id, OLDER.id))
    await waitFor(() => expect(first.result.current.dialog?.heldIds).toEqual([]))
    act(() => first.result.current.close())
    first.unmount()
    // Navigating back takes far longer than the zero-delay tick a closed read is dropped on.
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

    readStampedLeadIds.mockResolvedValueOnce(new Set([NEWER.id]))
    const second = renderHook(() => useCollisionResolve(BRANCH, ctx, run, NOWHERE), shared)
    act(() => second.result.current.request(NEWER.id, OLDER.id))

    expect(second.result.current.dialog).toBeNull()
    await waitFor(() => expect(second.result.current.dialog?.heldIds).toEqual([NEWER.id]))
    expect(readStampedLeadIds).toHaveBeenCalledTimes(2)
  })

  it('opens no dialog when the stamp read fails, closing the request with a toast', async () => {
    readStampedLeadIds.mockRejectedValueOnce(new Error('SQLITE_BUSY: database is locked'))
    const dialogs: (CollisionDialog | null)[] = []
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      const hook = useCollisionResolve(BRANCH, ctx, run, NOWHERE)
      dialogs.push(hook.dialog)
      return hook
    }, queries())
    act(() => result.current.request(NEWER.id, OLDER.id))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(HELD_FAILED_TEXT))
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(dialogs.every((dialog) => dialog == null)).toBe(true)
    expect(logger.error).toHaveBeenCalledWith(
      'app.world_collision_held_read_failed',
      expect.objectContaining({
        branchId: BRANCH,
        ids: [NEWER.id, OLDER.id],
        error: 'SQLITE_BUSY: database is locked',
      }),
    )
    // Closed: the hook no longer follows the pair's rows.
    const settled = renders
    act(() => entitiesStore.hydrate(BRANCH, [OLDER, { ...NEWER, description: 'Edited.' }]))
    expect(renders).toBe(settled)

    // A reopen starts from its own read, not the failed one.
    readStampedLeadIds.mockResolvedValueOnce(new Set([NEWER.id]))
    act(() => result.current.request(NEWER.id, OLDER.id))
    expect(result.current.dialog).toBeNull()
    await waitFor(() => expect(result.current.dialog?.heldIds).toEqual([NEWER.id]))
    expect(toast.error).toHaveBeenCalledTimes(1)
  })
})

describe('collisionResolveProp', () => {
  const onResolve = () => {}

  it('passes the handler through while writes are open', () => {
    expect(collisionResolveProp(undefined, onResolve)).toStrictEqual({ onResolve })
  })

  it("disables Resolve with the gate's reason during a turn", () => {
    expect(
      collisionResolveProp('Chapter close in progress. Cancel to edit.', onResolve),
    ).toStrictEqual({ disabledReason: 'Chapter close in progress. Cancel to edit.' })
  })
})
