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
})
