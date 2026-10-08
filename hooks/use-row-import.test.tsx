// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ImportRowResult } from '@/lib/actions'

import { useRowImport, type UseRowImportArgs } from './use-row-import'

type Payload = { name: string }
const PAYLOAD: Payload = { name: 'Kael' }

function args(overrides: Partial<UseRowImportArgs<Payload>> = {}): UseRowImportArgs<Payload> {
  return {
    blocked: false,
    guard: vi.fn((proceed: () => void) => proceed()),
    commit: vi.fn(async (): Promise<ImportRowResult> => ({ status: 'ok', id: 'char_new' })),
    onImported: vi.fn(),
    onRejected: vi.fn(),
    onFailed: vi.fn(),
    ...overrides,
  }
}

function setup(initial: UseRowImportArgs<Payload>) {
  return renderHook((props: UseRowImportArgs<Payload>) => useRowImport(props), {
    initialProps: initial,
  })
}

afterEach(() => {
  cleanup()
})

describe('useRowImport — opening', () => {
  it('opens through the leave guard', () => {
    const initial = args()
    const { result } = setup(initial)
    expect(result.current.open).toBe(false)
    act(() => result.current.request())
    expect(initial.guard).toHaveBeenCalledTimes(1)
    expect(result.current.open).toBe(true)
  })

  it('stays closed while the guard holds the request (a dirty draft not yet resolved)', () => {
    const initial = args({ guard: vi.fn() })
    const { result } = setup(initial)
    act(() => result.current.request())
    expect(initial.guard).toHaveBeenCalledTimes(1)
    expect(result.current.open).toBe(false)
  })

  it('refuses a request while generation is in flight, without asking the guard', () => {
    const initial = args({ blocked: true })
    const { result } = setup(initial)
    act(() => result.current.request())
    expect(initial.guard).not.toHaveBeenCalled()
    expect(result.current.open).toBe(false)
  })

  it('closes an open dialog when the gate engages, and keeps it closed once it lifts', () => {
    const initial = args()
    const { result, rerender } = setup(initial)
    act(() => result.current.request())
    expect(result.current.open).toBe(true)
    rerender({ ...initial, blocked: true })
    expect(result.current.open).toBe(false)
    rerender({ ...initial, blocked: false })
    expect(result.current.open).toBe(false)
  })

  it('keeps a request the guard releases after the gate engaged closed', () => {
    let release = () => {}
    const initial = args({
      guard: vi.fn((proceed: () => void) => {
        release = proceed
      }),
    })
    const { result, rerender } = setup(initial)
    act(() => result.current.request())
    rerender({ ...initial, blocked: true })
    act(() => release())
    expect(result.current.open).toBe(false)
    rerender({ ...initial, blocked: false })
    expect(result.current.open).toBe(false)
  })

  it('never commits an open dialog while blocked, even for a request released late', () => {
    const committed: { blocked: boolean; open: boolean }[] = []
    let release = () => {}
    const initial = args({
      guard: vi.fn((proceed: () => void) => {
        release = proceed
      }),
    })
    const { result, rerender } = renderHook(
      (props: UseRowImportArgs<Payload>) => {
        const row = useRowImport(props)
        useLayoutEffect(() => {
          committed.push({ blocked: props.blocked, open: row.open })
        })
        return row
      },
      { initialProps: initial },
    )
    act(() => result.current.request())
    rerender({ ...initial, blocked: true })
    act(() => release())
    expect(committed.length).toBeGreaterThan(1)
    expect(committed.filter((c) => c.blocked && c.open)).toEqual([])
  })

  it('closes through onOpenChange, as the dialog does after a success or a dismiss', () => {
    const { result } = setup(args())
    act(() => result.current.request())
    act(() => result.current.onOpenChange(false))
    expect(result.current.open).toBe(false)
  })
})

describe('useRowImport — committing', () => {
  it('commits the validated payload and hands the new id to onImported', async () => {
    const initial = args()
    const { result } = setup(initial)
    act(() => result.current.onValidated(PAYLOAD))
    await vi.waitFor(() => expect(initial.onImported).toHaveBeenCalledWith('char_new'))
    expect(initial.commit).toHaveBeenCalledWith(PAYLOAD)
    expect(initial.onRejected).not.toHaveBeenCalled()
    expect(initial.onFailed).not.toHaveBeenCalled()
  })

  it('hands a refusal code to onRejected', async () => {
    const initial = args({
      commit: vi.fn(
        async (): Promise<ImportRowResult> => ({
          status: 'rejected',
          reason: 'generation in flight',
          code: 'in-flight',
        }),
      ),
    })
    const { result } = setup(initial)
    act(() => result.current.onValidated(PAYLOAD))
    await vi.waitFor(() => expect(initial.onRejected).toHaveBeenCalledWith('in-flight'))
    expect(initial.onImported).not.toHaveBeenCalled()
    expect(initial.onFailed).not.toHaveBeenCalled()
  })

  it('hands a synchronous throw from commit to onFailed', async () => {
    const failure = new Error('commit threw before returning a promise')
    const initial = args({
      commit: vi.fn((): Promise<ImportRowResult> => {
        throw failure
      }),
    })
    const { result } = setup(initial)
    act(() => result.current.onValidated(PAYLOAD))
    await vi.waitFor(() => expect(initial.onFailed).toHaveBeenCalledWith(failure))
    expect(initial.onImported).not.toHaveBeenCalled()
    expect(initial.onRejected).not.toHaveBeenCalled()
  })

  it('hands a failed write to onFailed', async () => {
    const failure = new Error('SQLITE_BUSY: database is locked')
    const initial = args({
      commit: vi.fn(async (): Promise<ImportRowResult> => {
        throw failure
      }),
    })
    const { result } = setup(initial)
    act(() => result.current.onValidated(PAYLOAD))
    await vi.waitFor(() => expect(initial.onFailed).toHaveBeenCalledWith(failure))
    expect(initial.onImported).not.toHaveBeenCalled()
    expect(initial.onRejected).not.toHaveBeenCalled()
  })
})
