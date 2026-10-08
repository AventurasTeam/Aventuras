// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LEAD_REJECTION, type SetStoryLeadResult } from '@/lib/actions'
import { logger } from '@/lib/diagnostics'
import { toast } from '@/lib/toast'

import { useSetLead } from './use-set-lead'

const setStoryLead = vi.hoisted(() => vi.fn())

vi.mock('@/lib/actions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  setStoryLead,
}))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const STORY = 'story_1'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  setStoryLead.mockReset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useSetLead', () => {
  it('writes the lead and shows no toast on success', async () => {
    setStoryLead.mockResolvedValue({ status: 'ok' } satisfies SetStoryLeadResult)
    const { result } = renderHook(() => useSetLead(STORY))

    act(() => result.current.setLead('char_mira'))
    expect(result.current.pending).toBe(true)
    await waitFor(() => expect(result.current.pending).toBe(false))

    expect(setStoryLead).toHaveBeenCalledTimes(1)
    expect(setStoryLead).toHaveBeenCalledWith(
      STORY,
      'char_mira',
      expect.objectContaining({ runInTransaction: expect.any(Function) }),
    )
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('toasts the refusal when the action refuses', async () => {
    setStoryLead.mockResolvedValue({
      status: 'rejected',
      code: LEAD_REJECTION.notActive,
    } satisfies SetStoryLeadResult)
    const { result } = renderHook(() => useSetLead(STORY))

    act(() => result.current.setLead('char_vorne'))
    await waitFor(() => expect(result.current.pending).toBe(false))

    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('Only an active character can be the lead.')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('logs and toasts when the action throws', async () => {
    setStoryLead.mockRejectedValue(new Error('disk full'))
    const error = vi.spyOn(logger, 'error')
    const { result } = renderHook(() => useSetLead(STORY))

    act(() => result.current.setLead('char_mira'))
    await waitFor(() => expect(result.current.pending).toBe(false))

    expect(error).toHaveBeenCalledWith('reader.peek_set_lead_failed', {
      storyId: STORY,
      entityId: 'char_mira',
      error: 'disk full',
    })
    expect(toast.error).toHaveBeenCalledWith("Couldn't change the lead.")
  })

  it('ignores a press while a call is in flight, then takes the next', async () => {
    const first = deferred<SetStoryLeadResult>()
    setStoryLead.mockReturnValueOnce(first.promise).mockResolvedValue({ status: 'ok' })
    const { result } = renderHook(() => useSetLead(STORY))

    // Both in one act: the second press lands before the pending render.
    act(() => {
      result.current.setLead('char_mira')
      result.current.setLead('char_kael')
    })
    expect(result.current.pending).toBe(true)
    act(() => result.current.setLead('char_kael'))
    expect(setStoryLead).toHaveBeenCalledTimes(1)
    expect(setStoryLead).toHaveBeenLastCalledWith(STORY, 'char_mira', expect.anything())

    await act(async () => {
      first.resolve({ status: 'ok' })
      await first.promise
    })
    await waitFor(() => expect(result.current.pending).toBe(false))

    act(() => result.current.setLead('char_kael'))
    expect(setStoryLead).toHaveBeenCalledTimes(2)
    expect(setStoryLead).toHaveBeenLastCalledWith(STORY, 'char_kael', expect.anything())
    await waitFor(() => expect(result.current.pending).toBe(false))
  })

  it('does nothing without an open story', () => {
    const { result } = renderHook(() => useSetLead(null))

    act(() => result.current.setLead('char_mira'))

    expect(setStoryLead).not.toHaveBeenCalled()
    expect(result.current.pending).toBe(false)
  })
})
