// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ENTITY_DELETE_CODES, type DbCtx } from '@/lib/actions'
import { logger } from '@/lib/diagnostics'
import { makeEntity, makeLore } from '@/lib/list-modules/__tests__/fixtures'
import { entitiesStore, loreStore } from '@/lib/stores'
import { toast } from '@/lib/toast'

import { freshDeleteTarget, useWorldDelete } from './use-world-delete'

const deleteEntityRow = vi.hoisted(() => vi.fn())
const deleteRow = vi.hoisted(() => vi.fn())
vi.mock('@/lib/actions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deleteEntityRow,
  deleteRow,
}))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

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

describe('useWorldDelete → confirm', () => {
  const guard = (fn: () => void) => fn()

  beforeEach(() => {
    entitiesStore.hydrate(BRANCH, [MIRA])
    loreStore.hydrate(BRANCH, [VEIL])
    deleteEntityRow.mockReset()
    deleteRow.mockReset()
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.error).mockClear()
    vi.spyOn(logger, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('deletes an entity through deleteEntityRow', () => {
    deleteEntityRow.mockResolvedValue({ status: 'ok' })
    const { result } = renderHook(() => useWorldDelete(BRANCH, ctx, guard))
    act(() => result.current.request({ kind: 'entity', row: MIRA }))
    act(() => result.current.confirm())
    expect(deleteEntityRow).toHaveBeenCalledWith(BRANCH, MIRA.id, ctx)
  })

  it('deletes lore through deleteRow with the lore kind', () => {
    deleteRow.mockResolvedValue({ status: 'ok' })
    const { result } = renderHook(() => useWorldDelete(BRANCH, ctx, guard))
    act(() => result.current.request({ kind: 'lore', row: VEIL }))
    act(() => result.current.confirm())
    expect(deleteRow).toHaveBeenCalledWith('lore', BRANCH, VEIL.id, ctx)
  })

  it('toasts success on an ok result', async () => {
    deleteEntityRow.mockResolvedValue({ status: 'ok' })
    const { result } = renderHook(() => useWorldDelete(BRANCH, ctx, guard))
    act(() => result.current.request({ kind: 'entity', row: MIRA }))
    act(() => result.current.confirm())
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Deleted Mira.'))
  })

  it('toasts the in-flight refusal', async () => {
    deleteEntityRow.mockResolvedValue({
      status: 'rejected',
      reason: 'generation in flight',
      code: ENTITY_DELETE_CODES.inFlight,
    })
    const { result } = renderHook(() => useWorldDelete(BRANCH, ctx, guard))
    act(() => result.current.request({ kind: 'entity', row: MIRA }))
    act(() => result.current.confirm())
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't delete while generation is in flight."),
    )
  })

  it('toasts the lead-entity refusal', async () => {
    deleteEntityRow.mockResolvedValue({
      status: 'rejected',
      reason: 'lead entity',
      code: ENTITY_DELETE_CODES.leadEntity,
    })
    const { result } = renderHook(() => useWorldDelete(BRANCH, ctx, guard))
    act(() => result.current.request({ kind: 'entity', row: MIRA }))
    act(() => result.current.confirm())
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "The story's lead can't be deleted — set another character as lead first.",
      ),
    )
  })

  it('toasts the generic failure for any other refusal code', async () => {
    deleteRow.mockResolvedValue({ status: 'rejected', reason: 'gone', code: 'not-found' })
    const { result } = renderHook(() => useWorldDelete(BRANCH, ctx, guard))
    act(() => result.current.request({ kind: 'lore', row: VEIL }))
    act(() => result.current.confirm())
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't delete that."))
  })

  it('logs and toasts the generic failure when the delete throws', async () => {
    deleteEntityRow.mockRejectedValue(new Error('SQLITE_BUSY: database is locked'))
    const { result } = renderHook(() => useWorldDelete(BRANCH, ctx, guard))
    act(() => result.current.request({ kind: 'entity', row: MIRA }))
    act(() => result.current.confirm())
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't delete that."))
    expect(logger.error).toHaveBeenCalledWith(
      'app.world_delete_failed',
      expect.objectContaining({
        branchId: BRANCH,
        id: MIRA.id,
        error: 'SQLITE_BUSY: database is locked',
      }),
    )
  })
})
