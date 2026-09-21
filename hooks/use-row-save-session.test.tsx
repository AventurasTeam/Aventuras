// @vitest-environment jsdom
import { zodResolver } from '@hookform/resolvers/zod'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { Resolver } from 'react-hook-form'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { logger } from '@/lib/diagnostics'

import {
  useRowSaveSession,
  type RowCommitResult,
  type RowSaveOutcome,
  type RowSaveSession,
  type RowSaveSessionOptions,
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
const failureText = () => 'text:failed'

type Commit = (draft: Draft) => Promise<RowCommitResult>
type Props = { rowKey: string; values: Draft }

function okCommit() {
  return vi.fn<Commit>(async () => ({ status: 'ok' }))
}

/** A commit that stays in flight until the test settles or fails it. */
function heldCommit() {
  let settle: (result: RowCommitResult) => void = () => {}
  let fail: (error: Error) => void = () => {}
  const commit = vi.fn<Commit>(
    () =>
      new Promise<RowCommitResult>((resolve, reject) => {
        settle = resolve
        fail = reject
      }),
  )
  return {
    commit,
    settle: (result: RowCommitResult) => settle(result),
    fail: (error: Error) => fail(error),
  }
}

type Extras = Partial<Pick<RowSaveSessionOptions<Draft>, 'resolver' | 'onRejected'>> & {
  onRender?: (session: RowSaveSession<Draft>) => void
}

function setup(
  commit: Commit = okCommit(),
  initial: Props = { rowKey: 'row_1', values: VALUES },
  { onRender, resolver = zodResolver(schema), onRejected }: Extras = {},
) {
  const hook = renderHook(
    ({ rowKey, values }: Props) => {
      const session = useRowSaveSession<Draft>({
        rowKey,
        values,
        resolver,
        fieldLabel,
        issueText,
        failureText,
        commit,
        onRejected,
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
    const onRejected = vi.fn()
    const hook = setup(commit, undefined, { onRejected })
    const proceed = vi.fn()
    act(() => hook.result.current.form.setValue('note', 'x', { shouldDirty: true }))
    act(() => hook.result.current.requestLeave(proceed))
    await act(async () => {
      hook.result.current.resolveLeave('save')
    })
    await vi.waitFor(() => expect(hook.result.current.saveError).toBe('generation in flight'))
    expect(onRejected).toHaveBeenCalledWith('generation in flight')
    expect(proceed).not.toHaveBeenCalled()
    expect(hook.result.current.pendingLeave).toBe(true)
    expect(hook.result.current.dirty).toBe(true)

    act(() => hook.result.current.resolveLeave('discard'))
    expect(proceed).toHaveBeenCalledTimes(1)
    expect(hook.result.current.pendingLeave).toBe(false)
    expect(hook.result.current.saveError).toBeNull()
    expect(hook.result.current.form.getValues()).toEqual(VALUES)
  })

  it('treats a thrown commit as a translated rejection instead of rejecting the save', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const commit = vi.fn<Commit>(async () => {
      throw new Error('SQLITE_BUSY: database is locked')
    })
    const onRejected = vi.fn()
    const hook = setup(commit, undefined, { onRejected })
    const proceed = vi.fn()
    act(() => hook.result.current.form.setValue('note', 'x', { shouldDirty: true }))
    act(() => hook.result.current.requestLeave(proceed))
    let outcome: RowSaveOutcome | undefined
    await act(async () => {
      outcome = await hook.result.current.save()
    })
    expect(outcome).toEqual({ status: 'rejected', reason: 'text:failed' })
    expect(hook.result.current.saveError).toBe('text:failed')
    expect(onRejected).toHaveBeenCalledWith('text:failed')
    expect(hook.result.current.pendingLeave).toBe(true)
    expect(proceed).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(error.mock.calls[0])).toContain('SQLITE_BUSY')
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
    const hook = setup(okCommit(), undefined, { onRender: (session) => seen.push(session.dirty) })
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
          failureText,
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
        failureText,
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
          failureText: () => 'failed',
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

  it('clears the previous rejection as soon as a retry starts writing', async () => {
    const held = heldCommit()
    held.commit.mockResolvedValueOnce({ status: 'rejected', reason: 'blocked' })
    const hook = setup(held.commit)
    act(() => hook.result.current.form.setValue('note', 'x', { shouldDirty: true }))
    await act(async () => {
      await hook.result.current.save()
    })
    expect(hook.result.current.saveError).toBe('blocked')
    let saving: Promise<RowSaveOutcome> | undefined
    await act(async () => {
      saving = hook.result.current.save()
    })
    expect(hook.result.current.saveError).toBeNull()
    await act(async () => {
      held.settle({ status: 'ok' })
      await saving
    })
    expect(hook.result.current.saveError).toBeNull()
  })

  it('resolves a throwing resolver as a translated rejection', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const onRejected = vi.fn()
    const commit = okCommit()
    const resolver: Resolver<Draft> = async () => {
      throw new Error('refine bug')
    }
    const hook = setup(commit, undefined, { resolver, onRejected })
    act(() => hook.result.current.form.setValue('note', 'x', { shouldDirty: true }))
    let outcome: RowSaveOutcome | undefined
    await act(async () => {
      outcome = await hook.result.current.save()
    })
    expect(outcome).toEqual({ status: 'rejected', reason: 'text:failed' })
    expect(commit).not.toHaveBeenCalled()
    expect(hook.result.current.saveError).toBe('text:failed')
    expect(onRejected).toHaveBeenCalledWith('text:failed')
    expect(hook.result.current.saving).toBe(false)
    expect(error).toHaveBeenCalledTimes(1)
  })

  it('reads as saving from the start of validation, matching the ignored discard', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const inner = zodResolver(schema)
    const resolver: Resolver<Draft> = async (values, context, options) => {
      await gate
      return inner(values, context, options)
    }
    const hook = setup(okCommit(), undefined, { resolver })
    act(() => hook.result.current.form.setValue('note', 'x', { shouldDirty: true }))
    let saving: Promise<RowSaveOutcome> | undefined
    await act(async () => {
      saving = hook.result.current.save()
    })
    expect(hook.result.current.saving).toBe(true)
    act(() => hook.result.current.discard())
    expect(hook.result.current.form.getValues('note')).toBe('x')
    await act(async () => {
      release()
      await saving
    })
    expect(hook.result.current.saving).toBe(false)
  })

  it('names a form-level issue the same way the bar does', async () => {
    const formLevel = schema.refine((draft) => draft.note !== draft.title, {
      message: 'sameAsTitle',
    })
    const commit = okCommit()
    const hook = setup(commit, undefined, { resolver: zodResolver(formLevel) })
    act(() => hook.result.current.form.setValue('note', 'Amulet', { shouldDirty: true }))
    let outcome: RowSaveOutcome | undefined
    await act(async () => {
      outcome = await hook.result.current.save()
    })
    expect(hook.result.current.invalidReason).toBe('text:sameAsTitle')
    expect(outcome).toEqual({ status: 'invalid', reason: 'text:sameAsTitle' })
    expect(commit).not.toHaveBeenCalled()
  })

  it('keeps a rejection that lands after a row switch off the new row', async () => {
    const held = heldCommit()
    const onRejected = vi.fn()
    const hook = setup(held.commit, undefined, { onRejected })
    const proceed = vi.fn()
    act(() => hook.result.current.form.setValue('note', 'x', { shouldDirty: true }))
    act(() => hook.result.current.requestLeave(proceed))
    await act(async () => {
      hook.result.current.resolveLeave('save')
    })
    hook.rerender({ rowKey: 'row_2', values: { title: 'Trust', note: '' } })
    await act(async () => held.settle({ status: 'rejected', reason: 'blocked' }))
    expect(hook.result.current.saveError).toBeNull()
    expect(onRejected).toHaveBeenCalledWith('blocked')
    expect(hook.result.current.pendingLeave).toBe(false)
    expect(proceed).toHaveBeenCalledTimes(1)
    expect(hook.result.current.saving).toBe(false)
  })

  it('keeps a throw that lands after a row switch off the new row', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    const held = heldCommit()
    const onRejected = vi.fn()
    const hook = setup(held.commit, undefined, { onRejected })
    const proceed = vi.fn()
    act(() => hook.result.current.form.setValue('note', 'x', { shouldDirty: true }))
    act(() => hook.result.current.requestLeave(proceed))
    await act(async () => {
      hook.result.current.resolveLeave('save')
    })
    hook.rerender({ rowKey: 'row_2', values: { title: 'Trust', note: '' } })
    await act(async () => held.fail(new Error('SQLITE_BUSY')))
    expect(hook.result.current.saveError).toBeNull()
    expect(onRejected).toHaveBeenCalledWith('text:failed')
    expect(hook.result.current.pendingLeave).toBe(false)
    expect(proceed).toHaveBeenCalledTimes(1)
  })

  it('holds the leave for an edit typed on the new row after a mid-commit switch', async () => {
    const held = heldCommit()
    const hook = setup(held.commit)
    const proceed = vi.fn()
    act(() => hook.result.current.form.setValue('note', 'x', { shouldDirty: true }))
    act(() => hook.result.current.requestLeave(proceed))
    let saving: Promise<RowSaveOutcome> | undefined
    await act(async () => {
      saving = hook.result.current.save()
    })
    hook.rerender({ rowKey: 'row_2', values: { title: 'Trust', note: '' } })
    act(() => hook.result.current.form.setValue('note', 'typed on row 2', { shouldDirty: true }))
    await act(async () => {
      held.settle({ status: 'ok' })
      await saving
    })
    expect(proceed).not.toHaveBeenCalled()
    expect(hook.result.current.pendingLeave).toBe(true)
    expect(hook.result.current.form.getValues()).toEqual({ title: 'Trust', note: 'typed on row 2' })
    expect(hook.result.current.dirty).toBe(true)
  })

  it('refreshes a shifted link row without grafting the patch onto its neighbour', () => {
    const linkRows = z.object({
      title: z.string(),
      links: z.array(z.object({ id: z.string(), role: z.string() })),
    })
    type Links = z.infer<typeof linkRows>
    const initial: Links = {
      title: 'Heist',
      links: [
        { id: 'A', role: 'witness' },
        { id: 'B', role: 'witness' },
      ],
    }
    const hook = renderHook(
      ({ values }: { values: Links }) =>
        useRowSaveSession<Links>({
          rowKey: 'happening_1',
          values,
          resolver: zodResolver(linkRows),
          fieldLabel: bareText,
          issueText: bareText,
          failureText,
          commit: async () => ({ status: 'ok' }),
        }),
      { initialProps: { values: initial } },
    )
    // What each row's role Controller registers on mount.
    act(() => {
      hook.result.current.form.register('links.0.role')
      hook.result.current.form.register('links.1.role')
    })
    act(() =>
      hook.result.current.form.setValue('links', [{ id: 'B', role: 'witness' }], {
        shouldDirty: true,
      }),
    )
    hook.rerender({
      values: {
        title: 'Heist (classified)',
        links: [
          { id: 'A', role: 'culprit' },
          { id: 'B', role: 'witness' },
        ],
      },
    })
    expect(hook.result.current.form.getValues()).toEqual({
      title: 'Heist (classified)',
      links: [{ id: 'B', role: 'witness' }],
    })
  })

  it('drops a field from the dirty list once a refresh matches the draft', () => {
    const hook = setup()
    act(() => hook.result.current.form.setValue('note', 'draft', { shouldDirty: true }))
    act(() => hook.result.current.form.setValue('title', 'Amulet 2', { shouldDirty: true }))
    hook.rerender({ rowKey: 'row_1', values: { title: 'Amulet', note: 'draft' } })
    expect(hook.result.current.dirtyFields).toEqual(['label:title'])
    expect(hook.result.current.form.getValues()).toEqual({ title: 'Amulet 2', note: 'draft' })
  })

  it('rebases on the store row when it lands mid-commit, releasing the waiting leave', async () => {
    const held = heldCommit()
    const hook = setup(held.commit)
    const proceed = vi.fn()
    act(() => hook.result.current.form.setValue('note', 'edited', { shouldDirty: true }))
    act(() => hook.result.current.requestLeave(proceed))
    let saving: Promise<RowSaveOutcome> | undefined
    await act(async () => {
      saving = hook.result.current.save()
    })
    const stored = { title: 'Amulet (classified)', note: 'edited, normalized' }
    hook.rerender({ rowKey: 'row_1', values: stored })
    await act(async () => {
      held.settle({ status: 'ok' })
      await saving
    })
    expect(hook.result.current.form.getValues()).toEqual(stored)
    expect(hook.result.current.dirty).toBe(false)
    expect(proceed).toHaveBeenCalledTimes(1)
    expect(hook.result.current.pendingLeave).toBe(false)
  })

  it('keeps a revert to the original value typed while the commit ran', async () => {
    const held = heldCommit()
    const hook = setup(held.commit)
    const proceed = vi.fn()
    act(() => hook.result.current.form.setValue('note', 'edited', { shouldDirty: true }))
    act(() => hook.result.current.requestLeave(proceed))
    let saving: Promise<RowSaveOutcome> | undefined
    await act(async () => {
      saving = hook.result.current.save()
    })
    act(() => hook.result.current.form.setValue('note', '', { shouldDirty: true }))
    await act(async () => {
      held.settle({ status: 'ok' })
      await saving
    })
    expect(hook.result.current.form.getValues('note')).toBe('')
    expect(hook.result.current.dirtyFields).toEqual(['label:note'])
    expect(proceed).not.toHaveBeenCalled()
    expect(hook.result.current.pendingLeave).toBe(true)
  })

  it('resolves the save even when onRejected throws', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const commit = vi.fn<Commit>(async () => ({ status: 'rejected', reason: 'blocked' }))
    const onRejected = () => {
      throw new Error('toast unavailable')
    }
    const hook = setup(commit, undefined, { onRejected })
    act(() => hook.result.current.form.setValue('note', 'x', { shouldDirty: true }))
    let outcome: RowSaveOutcome | undefined
    await act(async () => {
      outcome = await hook.result.current.save()
    })
    expect(outcome).toEqual({ status: 'rejected', reason: 'blocked' })
    expect(hook.result.current.saveError).toBe('blocked')
    expect(hook.result.current.saving).toBe(false)
    expect(error).toHaveBeenCalledTimes(1)
  })
})
