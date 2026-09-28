// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ROW_DELETE_REJECTION, type DbCtx } from '@/lib/actions'
import type { Happening, HappeningAwareness, HappeningInvolvement, Thread } from '@/lib/db'
import {
  happeningAwarenessStore,
  happeningInvolvementsStore,
  happeningsStore,
  threadsStore,
} from '@/lib/stores'

import {
  freshDeleteTarget,
  plotDeleteCopy,
  plotDeleteRejectionText,
  plotLinkCounts,
  usePlotDelete,
} from './use-plot-delete'

const ctx = {} as DbCtx
const BRANCH = 'br_1'

function thread(id: string, title: string, extra: Partial<Thread> = {}): Thread {
  return {
    id,
    branchId: BRANCH,
    title,
    description: null,
    category: null,
    icon: null,
    status: 'active',
    injectionMode: 'auto',
    triggeredAtEntryId: null,
    resolvedAtEntryId: null,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  }
}

function happening(id: string, title: string, extra: Partial<Happening> = {}): Happening {
  return {
    id,
    branchId: BRANCH,
    title,
    description: null,
    category: null,
    icon: null,
    temporal: null,
    occurredAtEntryId: null,
    commonKnowledge: 0,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  }
}

function involvement(
  id: string,
  happeningId: string,
  extra: Partial<HappeningInvolvement> = {},
): HappeningInvolvement {
  return { id, branchId: BRANCH, happeningId, entityId: 'char_1', role: null, ...extra }
}

function awareness(
  id: string,
  happeningId: string,
  extra: Partial<HappeningAwareness> = {},
): HappeningAwareness {
  return {
    id,
    branchId: BRANCH,
    happeningId,
    characterId: 'char_1',
    learnedAtEntryId: null,
    decayResistance: null,
    retrievalCount: 0,
    source: null,
    ...extra,
  }
}

const DEBT = thread('thread_debt', 'The debt')
const AMBUSH = happening('hap_ambush', 'The fire')

describe('plotDeleteCopy', () => {
  it('names a happening’s link rows', () => {
    const copy = plotDeleteCopy(
      { kind: 'happening', row: AMBUSH },
      { involvements: 2, awareness: 1 },
    )
    expect(copy.title).toBe('Delete The fire?')
    expect(copy.impacts).toEqual(['2 involvements', '1 awareness record'])
    expect(copy.confirmLabel).toBe('Delete happening')
  })

  it('lists nothing for a thread', () => {
    const copy = plotDeleteCopy({ kind: 'thread', row: DEBT }, { involvements: 0, awareness: 0 })
    expect(copy.impacts).toEqual([])
    expect(copy.confirmLabel).toBe('Delete thread')
  })

  it('reads the same undo copy World uses', () => {
    const copy = plotDeleteCopy({ kind: 'thread', row: DEBT }, { involvements: 0, awareness: 0 })
    expect(copy.description).toBe(
      'You can undo this from the reader: Undo last action in its menu, or Cmd/Ctrl-Z.',
    )
  })
})

describe('plotDeleteRejectionText', () => {
  it('names the in-flight refusal and falls back to the generic failure otherwise', () => {
    expect(plotDeleteRejectionText(ROW_DELETE_REJECTION.inFlight)).toBe(
      "Couldn't delete while generation is in flight.",
    )
    expect(plotDeleteRejectionText('not-found')).toBe("Couldn't delete that.")
    expect(plotDeleteRejectionText(undefined)).toBe("Couldn't delete that.")
  })
})

describe('freshDeleteTarget', () => {
  it('reads the current thread row by id, not the one captured at request time', () => {
    const renamed = { ...DEBT, title: 'The old debt' }
    const fresh = freshDeleteTarget(
      { kind: 'thread', row: DEBT },
      new Map([[renamed.id, renamed]]),
      new Map(),
    )
    expect(fresh).toEqual({ kind: 'thread', row: renamed })
  })

  it('reads the current happening row the same way', () => {
    const renamed = { ...AMBUSH, title: 'The blaze' }
    const fresh = freshDeleteTarget(
      { kind: 'happening', row: AMBUSH },
      new Map(),
      new Map([[renamed.id, renamed]]),
    )
    expect(fresh).toEqual({ kind: 'happening', row: renamed })
  })

  it('returns null when the row no longer exists', () => {
    expect(freshDeleteTarget({ kind: 'thread', row: DEBT }, new Map(), new Map())).toBeNull()
    expect(freshDeleteTarget({ kind: 'happening', row: AMBUSH }, new Map(), new Map())).toBeNull()
  })
})

afterEach(() => {
  cleanup()
  happeningInvolvementsStore.__reset()
  happeningAwarenessStore.__reset()
})

describe('plotLinkCounts', () => {
  it('is always zero for a thread', () => {
    expect(plotLinkCounts(BRANCH, { kind: 'thread', row: DEBT })).toEqual({
      involvements: 0,
      awareness: 0,
    })
  })

  it('counts only this happening’s own-branch link rows, not off-branch or other-happening rows', () => {
    happeningInvolvementsStore.hydrate(BRANCH, [
      involvement('inv_1', AMBUSH.id),
      involvement('inv_2', AMBUSH.id),
      // Another happening on the same branch.
      involvement('inv_3', 'hap_other'),
      // Same happening id, but a different branch.
      involvement('inv_4', AMBUSH.id, { branchId: 'br_2' }),
    ])
    happeningAwarenessStore.hydrate(BRANCH, [
      awareness('aw_1', AMBUSH.id),
      awareness('aw_2', 'hap_other'),
      awareness('aw_3', AMBUSH.id, { branchId: 'br_2' }),
    ])

    expect(plotLinkCounts(BRANCH, { kind: 'happening', row: AMBUSH })).toEqual({
      involvements: 2,
      awareness: 1,
    })
  })
})

describe('usePlotDelete', () => {
  beforeEach(() => {
    threadsStore.hydrate(BRANCH, [DEBT])
    happeningsStore.hydrate(BRANCH, [AMBUSH])
  })

  it("names the row's current title when a dirty-pane Save renamed it before the guard released", () => {
    let proceed: (() => void) | undefined
    const guard = (fn: () => void) => {
      proceed = fn
    }
    const { result } = renderHook(() => usePlotDelete(BRANCH, ctx, guard))

    act(() => result.current.request({ kind: 'thread', row: DEBT }))
    expect(proceed).toBeDefined()

    threadsStore.hydrate(BRANCH, [{ ...DEBT, title: 'The old debt' }])
    act(() => proceed?.())

    expect(result.current.copy?.title).toBe('Delete The old debt?')
  })

  it('drops the request instead of confirming a row that vanished while the guard was pending', () => {
    let proceed: (() => void) | undefined
    const guard = (fn: () => void) => {
      proceed = fn
    }
    const { result } = renderHook(() => usePlotDelete(BRANCH, ctx, guard))

    act(() => result.current.request({ kind: 'happening', row: AMBUSH }))
    happeningsStore.hydrate(BRANCH, [])
    act(() => proceed?.())

    expect(result.current.copy).toBeNull()
  })
})
