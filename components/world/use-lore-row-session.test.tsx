// @vitest-environment jsdom
import { zodResolver } from '@hookform/resolvers/zod'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useMemo, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { LoreSaveResult } from '@/lib/actions'
import type { Lore } from '@/lib/db'
import { makeLore } from '@/lib/list-modules/__tests__/fixtures'
import { loreDraftFrom, loreDraftSchema } from '@/lib/world'

import { useLoreRowSession } from './use-lore-row-session'
import { useWorldSelection } from './use-world-selection'

const resolver = zodResolver(loreDraftSchema)
const VEIL = makeLore({ id: 'lore_veil', title: 'The Veil', body: 'A curtain between worlds.' })

function setup(result: LoreSaveResult) {
  const onSave = vi.fn(async () => result)
  const onSaved = vi.fn()
  const onRejected = vi.fn()
  const values = loreDraftFrom(VEIL)
  const hook = renderHook(() =>
    useLoreRowSession({
      rowId: VEIL.id,
      values,
      resolver,
      onSave,
      onSaved,
      onRejected,
      onSession: () => {},
    }),
  )
  return { hook, onSave, onSaved, onRejected }
}

// The route's wiring: the save writes a row, and onSaved selects it.
function useHarness() {
  const [lore, setLore] = useState<Lore[]>([])
  const world = useWorldSelection({
    initialId: null,
    category: 'lore',
    entities: [],
    lore,
    ready: true,
  })
  const row = world.selection?.type === 'lore' ? world.selection.row : null
  const values = useMemo(() => loreDraftFrom(row), [row])
  const session = useLoreRowSession({
    rowId: row?.id ?? null,
    createSeq: world.selection?.type === 'create-lore' ? world.selection.seq : undefined,
    values,
    resolver,
    onSave: async (draft): Promise<LoreSaveResult> => {
      const id = `lore_${draft.title}`
      setLore((prev) => [...prev, makeLore({ id, title: draft.title, body: draft.body })])
      return { status: 'ok', id }
    },
    onSaved: world.select,
    onSession: () => {},
  })
  return { world, session }
}

afterEach(cleanup)

describe('useLoreRowSession', () => {
  it('reports a committed Save even when the saved handler throws', async () => {
    const { hook, onSaved, onRejected } = setup({ status: 'ok', id: VEIL.id })
    onSaved.mockImplementation(() => {
      throw new Error('select failed')
    })
    act(() => hook.result.current.form.setValue('priority', 40, { shouldDirty: true }))
    let outcome
    await act(async () => {
      outcome = await hook.result.current.save()
    })
    expect(outcome).toEqual({ status: 'committed' })
    expect(onSaved).toHaveBeenCalledWith(VEIL.id)
    expect(onRejected).not.toHaveBeenCalled()
  })

  it('translates a refusal code for the save bar and the route', async () => {
    const { hook, onRejected } = setup({ status: 'rejected', reason: 'busy', code: 'in-flight' })
    act(() => hook.result.current.form.setValue('priority', 40, { shouldDirty: true }))
    await act(async () => {
      await hook.result.current.save()
    })
    const text = "Couldn't save while generation is in flight. Your changes are still here."
    expect(onRejected).toHaveBeenCalledWith(text)
    expect(hook.result.current.saveError).toBe(text)
  })

  it('checks the whole draft on the first edit: a title alone cannot save', async () => {
    const hook = renderHook(() => useHarness())
    act(() => hook.result.current.world.startCreate())
    act(() =>
      hook.result.current.session.form.setValue('title', 'Vael', {
        shouldDirty: true,
        shouldValidate: true,
      }),
    )
    await waitFor(() =>
      expect(hook.result.current.session.invalidReason).toBe('Body: Lore needs a body.'),
    )
  })

  it('opens a blank draft when [+] Blank from a dirty create is answered with Save', async () => {
    const hook = renderHook(() => useHarness())
    act(() => hook.result.current.world.startCreate())
    act(() => {
      hook.result.current.session.form.setValue('title', 'Vael', { shouldDirty: true })
      hook.result.current.session.form.setValue('body', 'A drowned city.', { shouldDirty: true })
    })
    act(() => hook.result.current.session.requestLeave(hook.result.current.world.startCreate))
    await act(async () => {
      hook.result.current.session.resolveLeave('save')
    })
    expect(hook.result.current.world.selection).toEqual({ type: 'create-lore', seq: 2 })
    expect(hook.result.current.session.form.getValues()).toEqual(loreDraftFrom(null))
    expect(hook.result.current.session.dirty).toBe(false)
    expect(hook.result.current.session.invalidReason).toBeNull()
  })
})
