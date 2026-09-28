// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { DbCtx } from '@/lib/actions'
import { makeEntity, makeLore } from '@/lib/list-modules/__tests__/fixtures'
import { entitiesStore, loreStore } from '@/lib/stores'

import { freshDeleteTarget, useWorldDelete } from './use-world-delete'

const ctx = {} as DbCtx
const BRANCH = 'br_1'
const MIRA = makeEntity({ id: 'char_mira', kind: 'character', name: 'Mira' })
const VEIL = makeLore({ id: 'lore_veil', title: 'The Veil' })

describe('freshDeleteTarget', () => {
  it('reads the current entity row by id, not the one captured at request time', () => {
    const renamed = { ...MIRA, name: 'Kestrel' }
    const fresh = freshDeleteTarget(
      { kind: 'entity', row: MIRA },
      new Map([[renamed.id, renamed]]),
      new Map(),
    )
    expect(fresh).toEqual({ kind: 'entity', row: renamed })
  })

  it('reads the current lore row the same way', () => {
    const renamed = { ...VEIL, title: 'The Curtain' }
    const fresh = freshDeleteTarget(
      { kind: 'lore', row: VEIL },
      new Map(),
      new Map([[renamed.id, renamed]]),
    )
    expect(fresh).toEqual({ kind: 'lore', row: renamed })
  })

  it('returns null when the row no longer exists', () => {
    expect(freshDeleteTarget({ kind: 'entity', row: MIRA }, new Map(), new Map())).toBeNull()
    expect(freshDeleteTarget({ kind: 'lore', row: VEIL }, new Map(), new Map())).toBeNull()
  })
})

afterEach(cleanup)

describe('useWorldDelete', () => {
  beforeEach(() => {
    entitiesStore.hydrate(BRANCH, [MIRA])
    loreStore.hydrate(BRANCH, [VEIL])
  })

  it("names the row's current title when a dirty-pane Save renamed it before the guard released", () => {
    let proceed: (() => void) | undefined
    const guard = (fn: () => void) => {
      proceed = fn
    }
    const { result } = renderHook(() => useWorldDelete(BRANCH, ctx, guard))

    act(() => result.current.request({ kind: 'entity', row: MIRA }))
    expect(proceed).toBeDefined()

    // Save lands (and the guard releases) while the confirm was still queued behind it.
    entitiesStore.hydrate(BRANCH, [{ ...MIRA, name: 'Kestrel' }])
    act(() => proceed?.())

    expect(result.current.copy?.title).toBe('Delete Kestrel?')
  })

  it('drops the request instead of confirming a row that vanished while the guard was pending', () => {
    let proceed: (() => void) | undefined
    const guard = (fn: () => void) => {
      proceed = fn
    }
    const { result } = renderHook(() => useWorldDelete(BRANCH, ctx, guard))

    act(() => result.current.request({ kind: 'entity', row: MIRA }))
    entitiesStore.hydrate(BRANCH, [])
    act(() => proceed?.())

    expect(result.current.copy).toBeNull()
  })
})
