// @vitest-environment jsdom
import { zodResolver } from '@hookform/resolvers/zod'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { EntitySaveResult } from '@/lib/actions'
import { locationDraftFrom, locationDraftSchema, type LocationDraft } from '@/lib/world'

import { useEntityRowSession } from './use-entity-row-session'

const resolver = zodResolver(locationDraftSchema)
const VALUES: LocationDraft = { ...locationDraftFrom(null), name: 'Shop' }
const FIELD_ERRORS = {
  'parent-cycle': { field: 'parentLocationId' as const, message: 'parentCycle' },
}

function setup(result: EntitySaveResult) {
  const onSave = vi.fn(async () => result)
  const onSaved = vi.fn()
  const onRejected = vi.fn()
  const hook = renderHook(() =>
    useEntityRowSession<LocationDraft>({
      kind: 'location',
      rowId: 'loc_shop',
      values: VALUES,
      resolver,
      fieldLabel: (field) => field,
      issueText: (message) => `text:${message}`,
      onSave,
      onSaved,
      onRejected,
      onSession: () => {},
      fieldErrors: FIELD_ERRORS,
    }),
  )
  return { hook, onSave, onSaved, onRejected }
}

/** An `onSave` that stays in flight until the test settles it. */
function heldSave() {
  let settle: (result: EntitySaveResult) => void = () => {}
  const onSave = vi.fn(
    () =>
      new Promise<EntitySaveResult>((resolve) => {
        settle = resolve
      }),
  )
  return { onSave, settle: (result: EntitySaveResult) => settle(result) }
}

type SwitchableProps = { rowId: string; values: LocationDraft }

function setupSwitchable(onSave: (draft: LocationDraft) => Promise<EntitySaveResult>) {
  const onRejected = vi.fn()
  const hook = renderHook(
    ({ rowId, values }: SwitchableProps) =>
      useEntityRowSession<LocationDraft>({
        kind: 'location',
        rowId,
        values,
        resolver,
        fieldLabel: (field) => field,
        issueText: (message) => `text:${message}`,
        onSave,
        onSaved: () => {},
        onRejected,
        onSession: () => {},
        fieldErrors: FIELD_ERRORS,
      }),
    { initialProps: { rowId: 'loc_shop', values: VALUES } },
  )
  return { hook, onRejected }
}

afterEach(() => {
  cleanup()
})

describe('useEntityRowSession', () => {
  it('lands a parent-cycle refusal on the parent field until the parent changes', async () => {
    const { hook, onRejected } = setup({
      status: 'rejected',
      reason: 'parent-cycle',
      code: 'parent-cycle',
    })
    act(() => {
      hook.result.current.form.setValue('parentLocationId', 'loc_b', { shouldDirty: true })
    })
    await act(async () => {
      await hook.result.current.save()
    })
    expect(hook.result.current.form.getFieldState('parentLocationId').error?.message).toBe(
      'parentCycle',
    )
    expect(hook.result.current.invalidReason).toBe('text:parentCycle')
    expect(onRejected).toHaveBeenCalledWith('That parent would make this location part of itself.')

    act(() => {
      hook.result.current.form.setValue('parentLocationId', 'loc_c', {
        shouldDirty: true,
        shouldValidate: true,
      })
    })
    await waitFor(() => expect(hook.result.current.invalidReason).toBeNull())
  })

  it('reports the saved id', async () => {
    const { hook, onSaved } = setup({ status: 'ok', id: 'loc_shop' })
    act(() => {
      hook.result.current.form.setValue('condition', 'flooded', { shouldDirty: true })
    })
    await act(async () => {
      await hook.result.current.save()
    })
    expect(onSaved).toHaveBeenCalledWith('loc_shop')
  })

  it('sets no field error for a refusal code with no field mapping', async () => {
    const { hook, onRejected } = setup({
      status: 'rejected',
      reason: 'in-flight',
      code: 'in-flight',
    })
    act(() => {
      hook.result.current.form.setValue('condition', 'flooded', { shouldDirty: true })
    })
    await act(async () => {
      await hook.result.current.save()
    })
    expect(hook.result.current.form.getFieldState('parentLocationId').error).toBeUndefined()
    expect(onRejected).toHaveBeenCalledWith(
      "Couldn't save while generation is in flight. Your changes are still here.",
    )
  })

  it('keeps a late parent-cycle refusal off the row the session has since switched to', async () => {
    const held = heldSave()
    const { hook, onRejected } = setupSwitchable(held.onSave)
    act(() => {
      hook.result.current.form.setValue('parentLocationId', 'loc_b', { shouldDirty: true })
    })
    await act(async () => {
      void hook.result.current.save()
    })
    hook.rerender({ rowId: 'loc_other', values: { ...locationDraftFrom(null), name: 'Other' } })
    await act(async () => {
      held.settle({ status: 'rejected', reason: 'parent-cycle', code: 'parent-cycle' })
    })
    expect(hook.result.current.form.getFieldState('parentLocationId').error).toBeUndefined()
    expect(onRejected).toHaveBeenCalledWith('That parent would make this location part of itself.')
  })
})
