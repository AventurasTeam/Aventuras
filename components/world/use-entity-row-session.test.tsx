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

  // world.md → Settings: a place rule names its own field and places.
  it('lands a place refusal on the field it names, and the notice names its tab', async () => {
    const { hook, onRejected } = setup({
      status: 'rejected',
      reason: 'place rule: retired-parent',
      code: 'retired-parent',
      refusal: {
        code: 'retired-parent',
        field: 'status',
        parent: { id: 'loc_p', name: 'Port Vellis' },
      },
    })
    act(() => {
      hook.result.current.form.setValue('status', 'staged', { shouldDirty: true })
    })
    await act(async () => {
      await hook.result.current.save()
    })
    const text = 'Port Vellis is retired. Bring it back first.'
    const notice = `Settings: ${text}`
    expect(hook.result.current.form.getFieldState('status').error?.message).toBe(text)
    expect(hook.result.current.form.getFieldState('parentLocationId').error).toBeUndefined()
    expect(hook.result.current.invalidReason).toBe(notice)
    expect(onRejected).toHaveBeenCalledWith(notice)
    expect(hook.result.current.saveError).toBe(notice)
  })

  it('names the story inside a place, or the place itself when the story is there', async () => {
    const story = (storyId: string, field: 'injectionMode' | 'parentLocationId') =>
      setup({
        status: 'rejected',
        reason: 'place rule: story-inside',
        code: 'story-inside',
        refusal: {
          code: 'story-inside',
          field,
          place: { id: 'loc_p', name: 'Port Vellis' },
          story: { id: storyId, name: storyId === 'loc_p' ? 'Port Vellis' : 'The Rusty Anchor' },
        },
      })
    for (const [storyId, field, text, tab] of [
      [
        'loc_inn',
        'injectionMode',
        'The story is in The Rusty Anchor, inside Port Vellis.',
        'Settings',
      ],
      ['loc_p', 'injectionMode', 'The story is in Port Vellis.', 'Settings'],
      [
        'loc_inn',
        'parentLocationId',
        'The story is in The Rusty Anchor, inside Port Vellis.',
        'Connections',
      ],
    ] as const) {
      const { hook, onRejected } = story(storyId, field)
      act(() => {
        hook.result.current.form.setValue('condition', 'flooded', { shouldDirty: true })
      })
      await act(async () => {
        await hook.result.current.save()
      })
      expect(hook.result.current.form.getFieldState(field).error?.message).toBe(text)
      expect(hook.result.current.invalidReason).toBe(`${tab}: ${text}`)
      expect(onRejected).toHaveBeenCalledWith(`${tab}: ${text}`)
      cleanup()
    }
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

  it('reports a committed Save even when the saved handler throws', async () => {
    const { hook, onSaved, onRejected } = setup({ status: 'ok', id: 'loc_shop' })
    onSaved.mockImplementation(() => {
      throw new Error('select failed')
    })
    act(() => {
      hook.result.current.form.setValue('condition', 'flooded', { shouldDirty: true })
    })
    let outcome
    await act(async () => {
      outcome = await hook.result.current.save()
    })
    expect(outcome).toEqual({ status: 'committed' })
    expect(onRejected).not.toHaveBeenCalled()
  })

  it('hands onSave the draft alone, the dirty field as the user left it', async () => {
    const onSave = vi.fn(async () => ({ status: 'ok', id: 'loc_shop' }) as EntitySaveResult)
    const based = { ...VALUES, keywords: ['the shop'] }
    const hook = renderHook(
      ({ values }: { values: LocationDraft }) =>
        useEntityRowSession<LocationDraft>({
          kind: 'location',
          rowId: 'loc_shop',
          values,
          resolver,
          fieldLabel: (field) => field,
          issueText: (message) => message,
          onSave,
          onSaved: () => {},
          onSession: () => {},
        }),
      { initialProps: { values: based } },
    )
    act(() => {
      hook.result.current.form.setValue('keywords', ['the shop', 'the store'], {
        shouldDirty: true,
      })
    })
    hook.rerender({ values: { ...based, keywords: ['the shop', 'the old mill'] } })
    await act(async () => {
      await hook.result.current.save()
    })
    // The whole argument list: a base passed beside the draft fails this.
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ keywords: ['the shop', 'the store'] }),
    )
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
