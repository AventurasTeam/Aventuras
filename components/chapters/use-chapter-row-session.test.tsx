// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RowSessionHandle } from '@/hooks/use-row-save-session'
import type { ChapterSaveResult } from '@/lib/actions'
import { chapterDraftFrom, type ChapterDraft, type ChapterDraftRow } from '@/lib/chapters'
import { logger } from '@/lib/diagnostics'

import { useChapterRowSession, type ChapterRowSessionOptions } from './use-chapter-row-session'

const KEEP: ChapterDraftRow = {
  id: 'chap_keep',
  branchId: 'br_1',
  title: 'The Keep Leans Closer',
  theme: 'dread',
  summary: 'The courier reaches the keep at dusk.',
  keywords: ['Keep'],
}
const RAIN: ChapterDraftRow = {
  id: 'chap_rain',
  branchId: 'br_1',
  title: 'Nine Days of Rain',
  theme: 'patience',
  summary: 'The rain holds the road shut.',
  keywords: ['Rain'],
}
// Module-level, so each row's values keep one identity across renders, as the route's memo does.
const KEEP_VALUES = chapterDraftFrom(KEEP)
const RAIN_VALUES = chapterDraftFrom(RAIN)
const NONE_VALUES = chapterDraftFrom(null)

const OK: ChapterSaveResult = { status: 'ok', id: KEEP.id }

type Props = Pick<ChapterRowSessionOptions, 'rowId' | 'values'>

function setup(
  result: ChapterSaveResult,
  initialProps: Props = { rowId: KEEP.id, values: KEEP_VALUES },
) {
  const onSave = vi.fn(async (_draft: ChapterDraft): Promise<ChapterSaveResult> => result)
  const onSaved = vi.fn<(id: string) => void>()
  const onRejected = vi.fn<(reason: string) => void>()
  const onSession = vi.fn<(handle: RowSessionHandle | null) => void>()
  const hook = renderHook(
    (props: Props) => useChapterRowSession({ ...props, onSave, onSaved, onRejected, onSession }),
    { initialProps },
  )
  return { hook, onSave, onSaved, onRejected, onSession }
}

type Hook = ReturnType<typeof setup>['hook']

function editTitle(hook: Hook, title: string) {
  act(() => hook.result.current.form.setValue('title', title, { shouldDirty: true }))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useChapterRowSession', () => {
  it.each([
    ['in-flight', "Can't save while generation is running"],
    ['not-found', 'This chapter no longer exists'],
    ['failed', "Couldn't save the chapter"],
  ] as const)(
    'reads the %s refusal as its translated text, on the bar and to the route',
    async (code, text) => {
      const { hook, onRejected, onSaved } = setup({
        status: 'rejected',
        reason: 'developer reason',
        code,
      })
      editTitle(hook, 'The Keep Falls')
      let outcome
      await act(async () => {
        outcome = await hook.result.current.save()
      })
      expect(outcome).toEqual({ status: 'rejected', reason: text })
      expect(onRejected).toHaveBeenCalledWith(text)
      expect(hook.result.current.saveError).toBe(text)
      expect(onSaved).not.toHaveBeenCalled()
    },
  )

  it('reads a thrown save as the failure text, logs the raw error, and tells the route', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const { hook, onSave, onSaved, onRejected } = setup(OK)
    onSave.mockRejectedValue(new Error('SQLITE_BUSY'))
    editTitle(hook, 'The Keep Falls')
    let outcome
    await act(async () => {
      outcome = await hook.result.current.save()
    })
    expect(outcome).toEqual({ status: 'rejected', reason: "Couldn't save the chapter" })
    expect(onRejected).toHaveBeenCalledWith("Couldn't save the chapter")
    expect(hook.result.current.saveError).toBe("Couldn't save the chapter")
    expect(onSaved).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith('app.row_save_failed', { error: 'SQLITE_BUSY' })
  })

  it('reports a landed Save as committed even when the saved handler throws, and logs it', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const { hook, onSave, onSaved, onRejected } = setup(OK)
    onSaved.mockImplementation(() => {
      throw new Error('toast failed')
    })
    editTitle(hook, 'The Keep Falls')
    let outcome
    await act(async () => {
      outcome = await hook.result.current.save()
    })
    expect(outcome).toEqual({ status: 'committed' })
    expect(onSave).toHaveBeenCalledWith({ ...KEEP_VALUES, title: 'The Keep Falls' })
    expect(onSaved).toHaveBeenCalledWith(KEEP.id)
    expect(onRejected).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith('app.chapter_saved_handler_failed', {
      id: KEEP.id,
      error: 'toast failed',
    })
  })

  it('hands the route its handle, naming the dirty fields, and withdraws it on unmount', async () => {
    const { hook, onSession } = setup(OK)
    expect(onSession).toHaveBeenLastCalledWith({
      dirty: false,
      requestLeave: hook.result.current.requestLeave,
    })
    editTitle(hook, 'The Keep Falls')
    await waitFor(() =>
      expect(onSession).toHaveBeenLastCalledWith({
        dirty: true,
        requestLeave: hook.result.current.requestLeave,
      }),
    )
    expect(hook.result.current.dirtyFields).toEqual(['Title'])
    hook.unmount()
    expect(onSession).toHaveBeenLastCalledWith(null)
  })

  it('runs clean under the reserved key while no card is open, and lets a leave through at once', () => {
    const { hook, onSession } = setup(OK, { rowId: null, values: NONE_VALUES })
    expect(hook.result.current.dirty).toBe(false)
    expect(hook.result.current.form.getValues()).toEqual({
      title: '',
      theme: '',
      summary: '',
      keywords: [],
    })
    expect(onSession).toHaveBeenLastCalledWith({
      dirty: false,
      requestLeave: hook.result.current.requestLeave,
    })
    const proceed = vi.fn()
    hook.result.current.requestLeave(proceed)
    expect(proceed).toHaveBeenCalledTimes(1)
    expect(hook.result.current.pendingLeave).toBe(false)
  })

  it("loads a card's row when it opens, and resets to the next card's row when that opens", async () => {
    const { hook } = setup(OK, { rowId: null, values: NONE_VALUES })
    hook.rerender({ rowId: KEEP.id, values: KEEP_VALUES })
    expect(hook.result.current.form.getValues()).toEqual(KEEP_VALUES)
    expect(hook.result.current.dirty).toBe(false)

    editTitle(hook, 'The Keep Falls')
    await waitFor(() => expect(hook.result.current.dirty).toBe(true))

    hook.rerender({ rowId: RAIN.id, values: RAIN_VALUES })
    expect(hook.result.current.form.getValues()).toEqual(RAIN_VALUES)
    await waitFor(() => expect(hook.result.current.dirty).toBe(false))
  })

  it('drops a field issue once an edit is undone and the draft is clean again', async () => {
    // Blank committed values are the one place a clean draft can hold an invalid field.
    const { hook } = setup(OK, { rowId: null, values: NONE_VALUES })
    const { onChange } = hook.result.current.form.register('title')
    const typeTitle = (value: string) =>
      act(async () => {
        await onChange({ target: { name: 'title', value }, type: 'change' })
      })
    await typeTitle('Nine Days')
    await waitFor(() => expect(hook.result.current.invalidReason).toBe("Summary can't be empty"))
    await typeTitle('')
    await waitFor(() => expect(hook.result.current.dirty).toBe(false))
    expect(hook.result.current.form.formState.errors).toEqual({})
    expect(hook.result.current.invalidReason).toBeNull()
  })

  it("keeps the first edit's field issue when it makes a valid row invalid", async () => {
    const { hook } = setup(OK)
    const { onChange } = hook.result.current.form.register('title')
    await act(async () => {
      await onChange({ target: { name: 'title', value: '' }, type: 'change' })
    })
    await waitFor(() => expect(hook.result.current.dirty).toBe(true))
    await waitFor(() =>
      expect(hook.result.current.form.formState.errors.title?.message).toBe('titleRequired'),
    )
  })
})
