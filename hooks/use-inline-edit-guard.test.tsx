// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EditResult, EditSession } from '@/components/reader/reader-document-types'
import { STORY_ENTRY_REJECTION } from '@/lib/actions'
import { t } from '@/lib/i18n'
import { chapterOverlaysStore } from '@/lib/stores'

import {
  editRefusalReason,
  UNRESPONSIVE,
  useInlineEditGuard,
  type InlineEditPort,
} from './use-inline-edit-guard'

const stubs = vi.hoisted(() => ({
  focused: true,
  navigate: vi.fn<(path: string) => void>(),
  armedWith: [] as boolean[],
}))

vi.mock('@react-navigation/native', () => ({ useIsFocused: () => stubs.focused }))
vi.mock('./use-surface-navigate', () => ({ useSurfaceNavigate: () => stubs.navigate }))
vi.mock('./use-unsaved-changes-guard', () => ({
  useUnsavedChangesGuard: (dirty: boolean) => {
    stubs.armedWith.push(dirty)
  },
}))
// The real dialog renders rn-primitives chrome the unit project can't load; its props are what
// the hook decides.
vi.mock('@/components/compounds/unsaved-changes-dialog', () => ({
  UnsavedChangesDialog: () => null,
}))

type QueryAnswer = EditSession | null | typeof UNRESPONSIVE
type CommitAnswer = EditResult | typeof UNRESPONSIVE

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function fakePort(query: QueryAnswer, commit: CommitAnswer = { ok: true }) {
  return {
    query: vi.fn<InlineEditPort['query']>(async () => query),
    commit: vi.fn<InlineEditPort['commit']>(async () => commit),
    discard: vi.fn(),
  }
}

const DIRTY: EditSession = { entryId: 'e2', dirty: true }
const OPEN_GATE: { disabled: boolean; reason: string | undefined } = {
  disabled: false,
  reason: undefined,
}

function render(port: InlineEditPort, armed = true, saveGate = OPEN_GATE) {
  return renderHook(
    (props: { armed: boolean }) => useInlineEditGuard({ port, saveGate, ...props }),
    {
      initialProps: { armed },
    },
  )
}

type Rendered = ReturnType<typeof render>

const dialogOf = (r: Rendered) => r.result.current.dialog?.props

async function leave(r: Rendered, proceed = vi.fn()) {
  await act(async () => r.result.current.guard(proceed))
  return proceed
}

beforeEach(() => {
  stubs.focused = true
  stubs.navigate.mockReset()
  stubs.armedWith = []
  chapterOverlaysStore.__reset()
})
afterEach(() => cleanup())

describe('useInlineEditGuard', () => {
  it('lets a leave through at once, asking nothing, while unarmed', () => {
    const port = fakePort(DIRTY)
    const r = render(port, false)
    const proceed = vi.fn()
    r.result.current.guard(proceed)
    expect(proceed).toHaveBeenCalledOnce()
    expect(port.query).not.toHaveBeenCalled()
  })

  it('arms the window and pop guard with `armed`', () => {
    render(fakePort(DIRTY), true)
    expect(stubs.armedWith.at(-1)).toBe(true)
  })

  it.each([
    ['a clean draft', { entryId: 'e2', dirty: false }],
    ['no open editor', null],
  ])('proceeds with no dialog over %s', async (_, answer) => {
    const r = render(fakePort(answer))
    const proceed = await leave(r)
    expect(proceed).toHaveBeenCalledOnce()
    expect(dialogOf(r)?.open).toBe(false)
  })

  it('holds the leave behind the dialog over a dirty draft', async () => {
    const r = render(fakePort(DIRTY))
    const proceed = await leave(r)
    expect(proceed).not.toHaveBeenCalled()
    expect(dialogOf(r)?.open).toBe(true)
  })

  it("Save runs the editor's plain commit, then proceeds", async () => {
    const port = fakePort(DIRTY)
    const r = render(port)
    const proceed = await leave(r)

    await act(async () => dialogOf(r)?.onSave())

    expect(port.commit).toHaveBeenCalledOnce()
    expect(proceed).toHaveBeenCalledOnce()
    expect(dialogOf(r)?.open).toBe(false)
  })

  it.each([
    [STORY_ENTRY_REJECTION.inFlight, () => t('reader:actions.blockedWhileGenerating')],
    [STORY_ENTRY_REJECTION.deltaFailed, () => t('reader:editFailed')],
    [undefined, () => t('reader:editFailed')],
  ])('a Save refused with %s keeps the dialog up with its reason', async (code, reason) => {
    const r = render(fakePort(DIRTY, { ok: false, code }))
    const proceed = await leave(r)

    await act(async () => dialogOf(r)?.onSave())

    expect(proceed).not.toHaveBeenCalled()
    expect(dialogOf(r)?.open).toBe(true)
    expect(dialogOf(r)?.saving).toBe(false)
    expect(dialogOf(r)?.reason).toBe(reason())
  })

  it('Discard closes the editor and proceeds', async () => {
    const port = fakePort(DIRTY)
    const r = render(port)
    const proceed = await leave(r)

    act(() => dialogOf(r)?.onDiscard())

    expect(port.discard).toHaveBeenCalledOnce()
    expect(port.commit).not.toHaveBeenCalled()
    expect(proceed).toHaveBeenCalledOnce()
  })

  it('Cancel stays and drops the leave; the next leave asks again', async () => {
    const port = fakePort(DIRTY)
    const r = render(port)
    const cancelled = await leave(r)

    act(() => dialogOf(r)?.onCancel())
    expect(dialogOf(r)?.open).toBe(false)

    port.query.mockResolvedValue(null)
    const next = await leave(r)
    expect(port.query).toHaveBeenCalledTimes(2)
    expect(next).toHaveBeenCalledOnce()
    expect(cancelled).not.toHaveBeenCalled()
  })

  it("mirrors the editor's Save gate and its reason", async () => {
    const gate = { disabled: true, reason: t('generationGate.updatingMemory') }
    const r = render(fakePort(DIRTY), true, gate)
    await leave(r)
    expect(dialogOf(r)?.saveDisabled).toBe(true)
    expect(dialogOf(r)?.saveDisabledReason).toBe(gate.reason)
  })

  it('asks once for leaves raised while it asks, then lets them all through', async () => {
    const answer = deferred<QueryAnswer>()
    const port = { ...fakePort(null), query: vi.fn(() => answer.promise) }
    const r = render(port)
    const first = vi.fn()
    const second = vi.fn()
    act(() => r.result.current.guard(first))
    act(() => r.result.current.guard(second))

    await act(async () => answer.resolve({ entryId: 'e2', dirty: false }))

    expect(port.query).toHaveBeenCalledOnce()
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
  })

  it('runs every queued leave even when one throws', async () => {
    const answer = deferred<QueryAnswer>()
    const port = { ...fakePort(null), query: vi.fn(() => answer.promise) }
    const r = render(port)
    const second = vi.fn()
    act(() =>
      r.result.current.guard(() => {
        throw new Error('navigator gone')
      }),
    )
    act(() => r.result.current.guard(second))

    await act(async () => answer.resolve(null))

    expect(second).toHaveBeenCalledOnce()
  })

  it('drops a held leave when the screen loses focus', async () => {
    const r = render(fakePort(DIRTY))
    const proceed = await leave(r)
    stubs.focused = false
    r.rerender({ armed: true })
    expect(r.result.current.dialog).toBeNull()

    stubs.focused = true
    r.rerender({ armed: true })
    expect(dialogOf(r)?.open).toBe(false)
    expect(proceed).not.toHaveBeenCalled()
  })

  it('asks afresh after a refocus, ignoring an answer to the question focus loss dropped', async () => {
    const first = deferred<QueryAnswer>()
    const second = deferred<QueryAnswer>()
    const port = {
      ...fakePort(null),
      query: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
    }
    const r = render(port)
    act(() => r.result.current.guard(vi.fn()))
    stubs.focused = false
    r.rerender({ armed: true })
    stubs.focused = true
    r.rerender({ armed: true })

    const proceed = vi.fn()
    act(() => r.result.current.guard(proceed))
    expect(port.query).toHaveBeenCalledTimes(2)

    await act(async () => first.resolve({ entryId: 'e2', dirty: false }))
    expect(proceed).not.toHaveBeenCalled()

    await act(async () => second.resolve(DIRTY))
    expect(proceed).not.toHaveBeenCalled()
    expect(dialogOf(r)?.open).toBe(true)
  })

  it("lets a Save that outlived its dialog settle nothing of a newer one's", async () => {
    const commit = deferred<CommitAnswer>()
    const port = { ...fakePort(DIRTY), commit: vi.fn(() => commit.promise) }
    const r = render(port)
    await leave(r)
    act(() => dialogOf(r)?.onSave())
    stubs.focused = false
    r.rerender({ armed: true })
    stubs.focused = true
    r.rerender({ armed: true })
    const proceed = await leave(r)
    expect(dialogOf(r)?.open).toBe(true)

    await act(async () => commit.resolve({ ok: true }))

    expect(proceed).not.toHaveBeenCalled()
    expect(dialogOf(r)?.open).toBe(true)
    expect(dialogOf(r)?.saving).toBe(false)
  })

  it("opens degraded when the editor doesn't answer: Save off, Discard still leaves", async () => {
    const port = fakePort(UNRESPONSIVE)
    const r = render(port)
    const proceed = await leave(r)

    expect(dialogOf(r)?.open).toBe(true)
    expect(dialogOf(r)?.saveDisabled).toBe(true)
    expect(dialogOf(r)?.saveDisabledReason).toBe(t('reader:editGuard.unresponsive'))
    await act(async () => dialogOf(r)?.onSave())
    expect(port.commit).not.toHaveBeenCalled()

    act(() => dialogOf(r)?.onDiscard())
    expect(proceed).toHaveBeenCalledOnce()
  })

  it('keeps the dialog, Save still offered, when a commit goes unanswered', async () => {
    const r = render(fakePort(DIRTY, UNRESPONSIVE))
    const proceed = await leave(r)

    await act(async () => dialogOf(r)?.onSave())

    expect(proceed).not.toHaveBeenCalled()
    expect(dialogOf(r)?.reason).toBe(t('reader:editGuard.unresponsive'))
    expect(dialogOf(r)?.saveDisabled).toBe(false)
  })

  // C7: the close modal and a review row press run the registered surface's guard first.
  it('holds Close chapter… behind the dialog, opening the modal after Save', async () => {
    const r = render(fakePort(DIRTY))
    const unregister = chapterOverlaysStore.registerSurface({
      guard: r.result.current.guard,
      navigate: stubs.navigate,
    })

    await act(async () => chapterOverlaysStore.openCloseModal({ branchId: 'br_1' }))
    expect(chapterOverlaysStore.getState().closeModal).toBeNull()
    expect(dialogOf(r)?.open).toBe(true)

    await act(async () => dialogOf(r)?.onSave())
    expect(chapterOverlaysStore.getState().closeModal).toEqual({ branchId: 'br_1' })
    unregister()
  })

  it('navigates a guarded link once the leave clears', async () => {
    const r = render(fakePort(DIRTY))
    await act(async () => r.result.current.navigateGuarded('/world/br_1'))
    expect(stubs.navigate).not.toHaveBeenCalled()

    act(() => dialogOf(r)?.onDiscard())
    expect(stubs.navigate).toHaveBeenCalledWith('/world/br_1')
  })
})

describe('editRefusalReason', () => {
  it('names the run for a gated write and asks for a retry otherwise', () => {
    expect(editRefusalReason(STORY_ENTRY_REJECTION.inFlight)).toBe(
      t('reader:actions.blockedWhileGenerating'),
    )
    expect(editRefusalReason(STORY_ENTRY_REJECTION.notFound)).toBe(t('reader:editFailed'))
  })
})
