// @vitest-environment jsdom
import { zodResolver } from '@hookform/resolvers/zod'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { logger } from '@/lib/diagnostics'

import {
  useRowSaveSession,
  type RowCommitResult,
  type RowSaveOutcome,
  type RowSaveSession,
} from './use-row-save-session'

const schema = z.object({ title: z.string().min(1, 'titleRequired'), note: z.string() })
type Draft = z.infer<typeof schema>
const VALUES: Draft = { title: 'Amulet', note: '' }
const LINKED = { title: 'Heist', links: [{ role: 'bystander' }] }

// Module-level, as consumers pass them: an inline arrow re-creates every render and would
// mask a memo keyed on react-hook-form's in-place-mutated state.
const fieldLabel = (field: string) => `label:${field}`
const issueText = (message: string) => `text:${message}`
const bareText = (text: string) => text

type Commit = (draft: Draft) => Promise<RowCommitResult>
type Props = { rowKey: string; values: Draft }

function okCommit() {
  return vi.fn<Commit>(async () => ({ status: 'ok' }))
}

/** A commit that stays in flight until the test settles it. */
function heldCommit() {
  let settle: (result: RowCommitResult) => void = () => {}
  const commit = vi.fn<Commit>(
    () =>
      new Promise<RowCommitResult>((resolve) => {
        settle = resolve
      }),
  )
  return { commit, settle: (result: RowCommitResult) => settle(result) }
}

function setup(
  commit: Commit = okCommit(),
  initial: Props = { rowKey: 'row_1', values: VALUES },
  onRender?: (session: RowSaveSession<Draft>) => void,
) {
  const hook = renderHook(
    ({ rowKey, values }: Props) => {
      const session = useRowSaveSession<Draft>({
        rowKey,
        values,
        resolver: zodResolver(schema),
        fieldLabel,
        issueText,
        commit,
      })
      onRender?.(session)
      return session
    },
    { initialProps: initial },
  )
  return hook
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useRowSaveSession', () => {
  it('starts clean, lists dirty fields by label, and commits the draft once', async () => {
    const commit = okCommit()
    const hook = setup(commit)
    expect(hook.result.current.dirty).toBe(false)
    act(() => hook.result.current.form.setValue('note', 'edited', { shouldDirty: true }))
    expect(hook.result.current.dirty).toBe(true)
    expect(hook.result.current.dirtyFields).toEqual(['label:note'])
    let outcome: RowSaveOutcome | undefined
    await act(async () => {
      outcome = await hook.result.current.save()
    })
    expect(outcome).toEqual({ status: 'committed' })
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith({ title: 'Amulet', note: 'edited' })
    expect(hook.result.current.dirty).toBe(false)
  })

  it('refuses an invalid draft with the translated issue and never commits', async () => {
    const commit = okCommit()
    const hook = setup(commit)
    act(() =>
      hook.result.current.form.setValue('title', '', { shouldDirty: true, shouldValidate: true }),
    )
    await vi.waitFor(() => expect(hook.result.current.invalidReason).toBe('text:titleRequired'))
    let outcome: RowSaveOutcome | undefined
    await act(async () => {
      outcome = await hook.result.current.save()
    })
    expect(outcome).toEqual({ status: 'invalid', reason: 'text:titleRequired' })
    expect(commit).not.toHaveBeenCalled()
  })

  it('names the issue of a field that was never validated before the save', async () => {
    const commit = okCommit()
    const hook = setup(commit, { rowKey: 'create:thread', values: { title: '', note: '' } })
    act(() => hook.result.current.form.setValue('note', 'x', { shouldDirty: true }))
    expect(hook.result.current.invalidReason).toBeNull()
    let outcome: RowSaveOutcome | undefined
    await act(async () => {
      outcome = await hook.result.current.save()
    })
    expect(outcome).toEqual({ status: 'invalid', reason: 'text:titleRequired' })
    expect(hook.result.current.invalidReason).toBe('text:titleRequired')
    expect(commit).not.toHaveBeenCalled()
  })

  it('is a noop while clean', async () => {
    const commit = okCommit()
    const hook = setup(commit)
    let outcome: RowSaveOutcome | undefined
    await act(async () => {
      outcome = await hook.result.current.save()
    })
    expect(outcome).toEqual({ status: 'noop' })
    expect(commit).not.toHaveBeenCalled()
  })

  it('answers a second save while the first is still validating with busy', async () => {
    const commit = okCommit()
    const hook = setup(commit)
    act(() => hook.result.current.form.setValue('note', 'x', { shouldDirty: true }))
    let outcomes: RowSaveOutcome[] = []
    await act(async () => {
      outcomes = await Promise.all([hook.result.current.save(), hook.result.current.save()])
    })
    expect(outcomes).toEqual([{ status: 'committed' }, { status: 'busy' }])
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('runs a leave immediately while clean, queues it while dirty, drains on discard', () => {
    const hook = setup()
    const proceed = vi.fn()
    act(() => hook.result.current.requestLeave(proceed))
    expect(proceed).toHaveBeenCalledTimes(1)

    act(() => hook.result.current.form.setValue('note', 'x', { shouldDirty: true }))
    act(() => hook.result.current.requestLeave(proceed))
    expect(proceed).toHaveBeenCalledTimes(1)
    expect(hook.result.current.pendingLeave).toBe(true)

    act(() => hook.result.current.resolveLeave('cancel'))
    expect(hook.result.current.pendingLeave).toBe(false)
    expect(proceed).toHaveBeenCalledTimes(1)

    act(() => hook.result.current.requestLeave(proceed))
    act(() => hook.result.current.resolveLeave('discard'))
    expect(proceed).toHaveBeenCalledTimes(2)
    expect(hook.result.current.dirty).toBe(false)
    expect(hook.result.current.form.getValues()).toEqual(VALUES)
  })

  it('runs every queued leave oldest first once the save lands', async () => {
    const hook = setup()
    const order: string[] = []
    act(() => hook.result.current.form.setValue('note', 'x', { shouldDirty: true }))
    act(() => hook.result.current.requestLeave(() => order.push('close')))
    act(() => hook.result.current.requestLeave(() => order.push('back')))
    expect(order).toEqual([])
    await act(async () => {
      hook.result.current.resolveLeave('save')
    })
    expect(order).toEqual(['close', 'back'])
    expect(hook.result.current.pendingLeave).toBe(false)
  })

  it('runs every queued leave oldest first on discard', () => {
    const hook = setup()
    const order: string[] = []
    act(() => hook.result.current.form.setValue('note', 'x', { shouldDirty: true }))
    act(() => hook.result.current.requestLeave(() => order.push('close')))
    act(() => hook.result.current.requestLeave(() => order.push('back')))
    act(() => hook.result.current.resolveLeave('discard'))
    expect(order).toEqual(['close', 'back'])
  })

  it('drops every queued leave on cancel, not just the newest', () => {
    const hook = setup()
    const first = vi.fn()
    const second = vi.fn()
    act(() => hook.result.current.form.setValue('note', 'x', { shouldDirty: true }))
    act(() => hook.result.current.requestLeave(first))
    act(() => hook.result.current.requestLeave(second))
    act(() => hook.result.current.resolveLeave('cancel'))
    expect(hook.result.current.pendingLeave).toBe(false)
    act(() => hook.result.current.discard())
    act(() => hook.result.current.resolveLeave('discard'))
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
  })

  it('ignores a resolution with no leave queued', async () => {
    const commit = okCommit()
    const hook = setup(commit)
    act(() => hook.result.current.form.setValue('note', 'x', { shouldDirty: true }))
    act(() => hook.result.current.resolveLeave('discard'))
    expect(hook.result.current.form.getValues('note')).toBe('x')
    await act(async () => {
      hook.result.current.resolveLeave('save')
    })
    expect(commit).not.toHaveBeenCalled()
    expect(hook.result.current.dirty).toBe(true)
  })

  it('keeps the leave pending and surfaces the reason when the commit is rejected', async () => {
    const commit = vi.fn<Commit>(async () => ({
      status: 'rejected',
      reason: 'generation in flight',
    }))
    const hook = setup(commit)
    const proceed = vi.fn()
    act(() => hook.result.current.form.setValue('note', 'x', { shouldDirty: true }))
    act(() => hook.result.current.requestLeave(proceed))
    await act(async () => {
      hook.result.current.resolveLeave('save')
    })
    await vi.waitFor(() => expect(hook.result.current.saveError).toBe('generation in flight'))
    expect(proceed).not.toHaveBeenCalled()
    expect(hook.result.current.pendingLeave).toBe(true)
    expect(hook.result.current.dirty).toBe(true)

    act(() => hook.result.current.resolveLeave('discard'))
    expect(proceed).toHaveBeenCalledTimes(1)
    expect(hook.result.current.pendingLeave).toBe(false)
    expect(hook.result.current.saveError).toBeNull()
    expect(hook.result.current.form.getValues()).toEqual(VALUES)
  })

  it('treats a thrown commit as a rejection instead of rejecting the save', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const commit = vi.fn<Commit>(async () => {
      throw new Error('disk full')
    })
    const hook = setup(commit)
    const proceed = vi.fn()
    act(() => hook.result.current.form.setValue('note', 'x', { shouldDirty: true }))
    act(() => hook.result.current.requestLeave(proceed))
    let outcome: RowSaveOutcome | undefined
    await act(async () => {
      outcome = await hook.result.current.save()
    })
    expect(outcome).toEqual({ status: 'rejected', reason: 'disk full' })
    expect(hook.result.current.saveError).toBe('disk full')
    expect(hook.result.current.pendingLeave).toBe(true)
    expect(proceed).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledTimes(1)
  })

  it('ignores leave resolutions and discard while the commit is in flight', async () => {
    const held = heldCommit()
    const hook = setup(held.commit)
    const proceed = vi.fn()
    act(() => hook.result.current.form.setValue('note', 'x', { shouldDirty: true }))
    act(() => hook.result.current.requestLeave(proceed))
    await act(async () => {
      hook.result.current.resolveLeave('save')
    })
    expect(hook.result.current.saving).toBe(true)
    act(() => hook.result.current.resolveLeave('discard'))
    act(() => hook.result.current.resolveLeave('cancel'))
    act(() => hook.result.current.discard())
    expect(proceed).not.toHaveBeenCalled()
    expect(hook.result.current.pendingLeave).toBe(true)
    expect(hook.result.current.form.getValues('note')).toBe('x')

    await act(async () => held.settle({ status: 'ok' }))
    expect(proceed).toHaveBeenCalledTimes(1)
    expect(held.commit).toHaveBeenCalledTimes(1)
    expect(hook.result.current.saving).toBe(false)
  })

  it('releases a waiting leave when a save finds the session already clean', async () => {
    const commit = okCommit()
    const hook = setup(commit)
    const proceed = vi.fn()
    act(() => hook.result.current.form.setValue('note', 'x', { shouldDirty: true }))
    act(() => hook.result.current.requestLeave(proceed))
    act(() => hook.result.current.form.setValue('note', '', { shouldDirty: true }))
    expect(hook.result.current.dirty).toBe(false)
    let outcome: RowSaveOutcome | undefined
    await act(async () => {
      outcome = await hook.result.current.save()
    })
    expect(outcome).toEqual({ status: 'noop' })
    expect(proceed).toHaveBeenCalledTimes(1)
    expect(commit).not.toHaveBeenCalled()
  })

  it('keeps an edit made while the commit was in flight, and the leave with it', async () => {
    const held = heldCommit()
    const hook = setup(held.commit)
    const proceed = vi.fn()
    act(() => hook.result.current.form.setValue('note', 'x', { shouldDirty: true }))
    act(() => hook.result.current.requestLeave(proceed))
    let saving: Promise<RowSaveOutcome> | undefined
    await act(async () => {
      saving = hook.result.current.save()
    })
    expect(held.commit).toHaveBeenCalledWith({ title: 'Amulet', note: 'x' })
    act(() => hook.result.current.form.setValue('note', 'xy', { shouldDirty: true }))
    let outcome: RowSaveOutcome | undefined
    await act(async () => {
      held.settle({ status: 'ok' })
      outcome = await saving
    })
    expect(outcome).toEqual({ status: 'committed' })
    expect(hook.result.current.form.getValues('note')).toBe('xy')
    expect(hook.result.current.dirtyFields).toEqual(['label:note'])
    expect(proceed).not.toHaveBeenCalled()
    expect(hook.result.current.pendingLeave).toBe(true)

    act(() => hook.result.current.discard())
    expect(hook.result.current.form.getValues('note')).toBe('')
  })

  it('isolates a failing leave so the rest of the queue still runs', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const hook = setup()
    const after = vi.fn()
    act(() => hook.result.current.form.setValue('note', 'x', { shouldDirty: true }))
    act(() =>
      hook.result.current.requestLeave(() => {
        throw new Error('navigator gone')
      }),
    )
    act(() => hook.result.current.requestLeave(after))
    act(() => hook.result.current.resolveLeave('discard'))
    expect(after).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledTimes(1)
  })

  it('counts a dirtied field that the committed values omit', () => {
    const hook = setup(okCommit(), { rowKey: 'row_1', values: { title: 'Amulet' } as Draft })
    act(() => hook.result.current.form.setValue('note', 'x', { shouldDirty: true }))
    expect(hook.result.current.dirtyFields).toEqual(['label:note'])
    expect(hook.result.current.dirty).toBe(true)
  })

  it('follows a store refresh while clean', () => {
    const hook = setup()
    hook.rerender({ rowKey: 'row_1', values: { title: 'Amulet (patched)', note: '' } })
    expect(hook.result.current.form.getValues()).toEqual({ title: 'Amulet (patched)', note: '' })
    expect(hook.result.current.dirty).toBe(false)
  })

  it('commits the refreshed untouched fields, not the stale ones', async () => {
    const commit = okCommit()
    const hook = setup(commit)
    act(() => hook.result.current.form.setValue('note', 'draft', { shouldDirty: true }))
    hook.rerender({ rowKey: 'row_1', values: { title: 'Amulet (patched)', note: '' } })
    await act(async () => {
      await hook.result.current.save()
    })
    expect(commit).toHaveBeenCalledWith({ title: 'Amulet (patched)', note: 'draft' })
  })

  it('never reports clean mid-refresh while a draft is held', () => {
    const seen: boolean[] = []
    const hook = setup(okCommit(), undefined, (session) => seen.push(session.dirty))
    act(() => hook.result.current.form.setValue('note', 'draft', { shouldDirty: true }))
    seen.length = 0
    hook.rerender({ rowKey: 'row_1', values: { title: 'Amulet (patched)', note: '' } })
    expect(seen.length).toBeGreaterThan(0)
    expect(seen).not.toContain(false)
  })

  it('keeps a validation issue across a refresh of another field', async () => {
    const hook = setup()
    act(() =>
      hook.result.current.form.setValue('title', '', { shouldDirty: true, shouldValidate: true }),
    )
    await vi.waitFor(() => expect(hook.result.current.invalidReason).toBe('text:titleRequired'))
    hook.rerender({ rowKey: 'row_1', values: { title: 'Amulet', note: 'patched' } })
    expect(hook.result.current.invalidReason).toBe('text:titleRequired')
    await act(async () => {})
    expect(hook.result.current.form.getValues()).toEqual({ title: '', note: 'patched' })
    expect(hook.result.current.invalidReason).toBe('text:titleRequired')
  })

  it('re-checks a cross-field issue that a refresh of the other field resolves', async () => {
    const distinct = schema.refine((draft) => draft.note !== draft.title, {
      message: 'sameAsTitle',
      path: ['note'],
    })
    const hook = renderHook(
      ({ values }: { values: Draft }) =>
        useRowSaveSession<Draft>({
          rowKey: 'row_1',
          values,
          resolver: zodResolver(distinct),
          fieldLabel,
          issueText,
          commit: okCommit(),
        }),
      { initialProps: { values: VALUES } },
    )
    act(() =>
      hook.result.current.form.setValue('note', 'Amulet', {
        shouldDirty: true,
        shouldValidate: true,
      }),
    )
    await vi.waitFor(() => expect(hook.result.current.invalidReason).toBe('text:sameAsTitle'))
    hook.rerender({ values: { title: 'Brooch', note: '' } })
    await vi.waitFor(() => expect(hook.result.current.invalidReason).toBeNull())
    expect(hook.result.current.form.getValues()).toEqual({ title: 'Brooch', note: 'Amulet' })
  })

  it('keeps a draft across a values refresh and resets on a row switch', () => {
    const hook = setup()
    act(() => hook.result.current.form.setValue('note', 'draft', { shouldDirty: true }))
    hook.rerender({ rowKey: 'row_1', values: { title: 'Amulet (patched)', note: '' } })
    expect(hook.result.current.form.getValues('note')).toBe('draft')
    expect(hook.result.current.form.getValues('title')).toBe('Amulet (patched)')
    expect(hook.result.current.dirtyFields).toEqual(['label:note'])
    hook.rerender({ rowKey: 'row_2', values: { title: 'Trust', note: 'n' } })
    expect(hook.result.current.form.getValues()).toEqual({ title: 'Trust', note: 'n' })
    expect(hook.result.current.dirty).toBe(false)
  })

  it('drops the previous row’s save error on a row switch', async () => {
    const commit = vi.fn<Commit>(async () => ({ status: 'rejected', reason: 'blocked' }))
    const hook = setup(commit)
    act(() => hook.result.current.form.setValue('note', 'x', { shouldDirty: true }))
    await act(async () => {
      await hook.result.current.save()
    })
    expect(hook.result.current.saveError).toBe('blocked')
    hook.rerender({ rowKey: 'row_2', values: { title: 'Trust', note: '' } })
    expect(hook.result.current.saveError).toBeNull()
  })

  it('leaves the new row alone when rows switched before the save settled', async () => {
    const held = heldCommit()
    const hook = setup(held.commit, { rowKey: 'create:thread', values: { title: '', note: '' } })
    const proceed = vi.fn()
    act(() => hook.result.current.form.setValue('title', 'Created', { shouldDirty: true }))
    act(() => hook.result.current.requestLeave(proceed))
    let saving: Promise<RowSaveOutcome> | undefined
    await act(async () => {
      saving = hook.result.current.save()
    })
    const created = { title: 'Created', note: 'from the store' }
    hook.rerender({ rowKey: 'row_new', values: created })
    await act(async () => {
      held.settle({ status: 'ok' })
      await saving
    })
    expect(hook.result.current.form.getValues()).toEqual(created)
    expect(hook.result.current.dirty).toBe(false)
    expect(proceed).toHaveBeenCalledTimes(1)
  })

  it('lists dirty fields in draft order, dropping one that is reverted', () => {
    const hook = setup()
    act(() => hook.result.current.form.setValue('note', 'x', { shouldDirty: true }))
    act(() => hook.result.current.form.setValue('title', 'Amulet 2', { shouldDirty: true }))
    expect(hook.result.current.dirtyFields).toEqual(['label:title', 'label:note'])
    act(() => hook.result.current.form.setValue('note', '', { shouldDirty: true }))
    expect(hook.result.current.dirtyFields).toEqual(['label:title'])
    expect(hook.result.current.dirty).toBe(true)
  })

  it('keeps the form and requestLeave identities across renders', () => {
    const hook = setup()
    const { form, requestLeave } = hook.result.current
    act(() => hook.result.current.form.setValue('note', 'x', { shouldDirty: true }))
    hook.rerender({ rowKey: 'row_1', values: { title: 'Amulet (patched)', note: '' } })
    expect(hook.result.current.form).toBe(form)
    expect(hook.result.current.requestLeave).toBe(requestLeave)
  })

  it('commits a snapshot that a nested edit made mid-commit cannot reach', async () => {
    const linked = z.object({ title: z.string(), links: z.array(z.object({ role: z.string() })) })
    type Linked = z.infer<typeof linked>
    let settle: (result: RowCommitResult) => void = () => {}
    const commit = vi.fn(
      (_draft: Linked) =>
        new Promise<RowCommitResult>((resolve) => {
          settle = resolve
        }),
    )
    const hook = renderHook(() =>
      useRowSaveSession<Linked>({
        rowKey: 'happening_1',
        values: LINKED,
        resolver: zodResolver(linked),
        fieldLabel: bareText,
        issueText: bareText,
        commit,
      }),
    )
    act(() => hook.result.current.form.setValue('links.0.role', 'witness', { shouldDirty: true }))
    let saving: Promise<RowSaveOutcome> | undefined
    await act(async () => {
      saving = hook.result.current.save()
    })
    act(() => hook.result.current.form.setValue('links.0.role', 'culprit', { shouldDirty: true }))
    await act(async () => {
      settle({ status: 'ok' })
      await saving
    })
    expect(commit).toHaveBeenCalledWith({ title: 'Heist', links: [{ role: 'witness' }] })
    expect(hook.result.current.form.getValues('links.0.role')).toBe('culprit')
    expect(hook.result.current.dirtyFields).toEqual(['links'])
  })

  it('does not loop when the caller passes fresh but equal values each render', () => {
    let renders = 0
    const hook = renderHook(
      ({ rowKey }: { rowKey: string }) => {
        renders += 1
        if (renders > 100) throw new Error('render loop')
        return useRowSaveSession<Draft>({
          rowKey,
          values: { ...VALUES },
          resolver: zodResolver(schema),
          fieldLabel: (field) => field,
          issueText: (message) => message,
          commit: okCommit(),
        })
      },
      { initialProps: { rowKey: 'row_1' } },
    )
    act(() => hook.result.current.form.setValue('note', 'draft', { shouldDirty: true }))
    const before = renders
    hook.rerender({ rowKey: 'row_1' })
    expect(renders - before).toBeLessThan(4)
    expect(hook.result.current.form.getValues('note')).toBe('draft')
    expect(hook.result.current.dirty).toBe(true)
  })
})
