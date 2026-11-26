// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LEAD_REJECTION, type SetLeadResult } from '@/lib/actions'
import { logger } from '@/lib/diagnostics'
import { toast } from '@/lib/toast'

import type { PeekLeadControl } from './peek-model'
import { usePeekLeadControl, useSetLead } from './use-set-lead'

const setBranchLead = vi.hoisted(() => vi.fn())

vi.mock('@/lib/actions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  setBranchLead,
}))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// Not the story's main branch: the peek writes the branch its host reads.
const BRANCH = 'br_fork'
const ANY_CTX = expect.objectContaining({ runInTransaction: expect.any(Function) })

beforeEach(() => {
  vi.clearAllMocks()
  setBranchLead.mockReset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useSetLead', () => {
  it('writes the lead on its branch and shows no toast on success', async () => {
    setBranchLead.mockResolvedValue({ status: 'ok' } satisfies SetLeadResult)
    const { result } = renderHook(() => useSetLead(BRANCH))

    act(() => result.current.setLead('char_mira'))
    expect(result.current.pending).toBe(true)
    await waitFor(() => expect(result.current.pending).toBe(false))

    expect(setBranchLead).toHaveBeenCalledTimes(1)
    expect(setBranchLead).toHaveBeenCalledWith(BRANCH, 'char_mira', ANY_CTX)
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('toasts the refusal when the action refuses', async () => {
    setBranchLead.mockResolvedValue({
      status: 'rejected',
      code: LEAD_REJECTION.notActive,
    } satisfies SetLeadResult)
    const { result } = renderHook(() => useSetLead(BRANCH))

    act(() => result.current.setLead('char_vorne'))
    await waitFor(() => expect(result.current.pending).toBe(false))

    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('Only an active character can be the lead.')
    expect(toast.success).not.toHaveBeenCalled()

    // A lock left held after the refusal would make this press a silent no-op.
    act(() => result.current.setLead('char_mira'))
    expect(setBranchLead).toHaveBeenCalledTimes(2)
    expect(setBranchLead).toHaveBeenLastCalledWith(BRANCH, 'char_mira', expect.anything())
    await waitFor(() => expect(result.current.pending).toBe(false))
  })

  it('logs and toasts when the action throws', async () => {
    setBranchLead
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValue({ status: 'ok' } satisfies SetLeadResult)
    const error = vi.spyOn(logger, 'error')
    const { result } = renderHook(() => useSetLead(BRANCH))

    act(() => result.current.setLead('char_mira'))
    await waitFor(() => expect(result.current.pending).toBe(false))

    expect(error).toHaveBeenCalledWith('reader.peek_set_lead_failed', {
      branchId: BRANCH,
      entityId: 'char_mira',
      error: 'disk full',
    })
    expect(toast.error).toHaveBeenCalledWith("Couldn't change the lead.")

    // A lock left held after the throw would make this press a silent no-op.
    act(() => result.current.setLead('char_vorne'))
    expect(setBranchLead).toHaveBeenCalledTimes(2)
    expect(setBranchLead).toHaveBeenLastCalledWith(BRANCH, 'char_vorne', expect.anything())
    await waitFor(() => expect(result.current.pending).toBe(false))
  })

  it('ignores a press while a call is in flight, then takes the next', async () => {
    const first = Promise.withResolvers<SetLeadResult>()
    setBranchLead.mockReturnValueOnce(first.promise).mockResolvedValue({ status: 'ok' })
    const { result } = renderHook(() => useSetLead(BRANCH))

    // Both in one act: the second press lands before the pending render.
    act(() => {
      result.current.setLead('char_mira')
      result.current.setLead('char_kael')
    })
    expect(result.current.pending).toBe(true)
    act(() => result.current.setLead('char_kael'))
    expect(setBranchLead).toHaveBeenCalledTimes(1)
    expect(setBranchLead).toHaveBeenLastCalledWith(BRANCH, 'char_mira', expect.anything())

    await act(async () => {
      first.resolve({ status: 'ok' })
      await first.promise
    })
    await waitFor(() => expect(result.current.pending).toBe(false))

    act(() => result.current.setLead('char_kael'))
    expect(setBranchLead).toHaveBeenCalledTimes(2)
    expect(setBranchLead).toHaveBeenLastCalledWith(BRANCH, 'char_kael', expect.anything())
    await waitFor(() => expect(result.current.pending).toBe(false))
  })

  it('logs and toasts instead of writing without a branch id', () => {
    setBranchLead.mockResolvedValue({ status: 'ok' } satisfies SetLeadResult)
    const error = vi.spyOn(logger, 'error')
    const { result } = renderHook(() => useSetLead(null))

    act(() => result.current.setLead('char_mira'))

    expect(setBranchLead).not.toHaveBeenCalled()
    expect(result.current.pending).toBe(false)
    expect(error).toHaveBeenCalledWith('reader.peek_set_lead_failed', {
      branchId: null,
      entityId: 'char_mira',
      error: 'no branch id',
    })
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith("Couldn't change the lead.")
  })
})

describe('usePeekLeadControl', () => {
  it('passes the gate and its reason through', () => {
    const { result, rerender } = renderHook<
      PeekLeadControl,
      { blocked: boolean; reason: string | undefined }
    >(({ blocked, reason }) => usePeekLeadControl(BRANCH, blocked, reason), {
      initialProps: { blocked: true, reason: 'Chapter close in progress.' },
    })
    expect(result.current).toMatchObject({
      blocked: true,
      blockedReason: 'Chapter close in progress.',
      pending: false,
    })

    rerender({ blocked: false, reason: undefined })
    expect(result.current).toMatchObject({ blocked: false, blockedReason: undefined })
  })

  it('keeps one control object while nothing it carries changes', () => {
    const { result, rerender } = renderHook(() => usePeekLeadControl(BRANCH, false, undefined))
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })

  it('sets the lead on the branch its host gives it, and follows the host to another branch', async () => {
    const call = Promise.withResolvers<SetLeadResult>()
    setBranchLead.mockReturnValueOnce(call.promise).mockResolvedValue({ status: 'ok' })
    const { result, rerender } = renderHook<PeekLeadControl, { branchId: string }>(
      ({ branchId }) => usePeekLeadControl(branchId, false, undefined),
      { initialProps: { branchId: 'br_main' } },
    )

    act(() => result.current.onSetLead('char_mira'))
    expect(setBranchLead).toHaveBeenCalledWith('br_main', 'char_mira', ANY_CTX)
    expect(result.current.pending).toBe(true)
    await act(async () => {
      call.resolve({ status: 'ok' })
      await call.promise
    })
    await waitFor(() => expect(result.current.pending).toBe(false))

    rerender({ branchId: BRANCH })
    act(() => result.current.onSetLead('char_mira'))
    expect(setBranchLead).toHaveBeenLastCalledWith(BRANCH, 'char_mira', ANY_CTX)
    await waitFor(() => expect(result.current.pending).toBe(false))
  })
})
