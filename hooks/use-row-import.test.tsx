// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ImportRowResult } from '@/lib/actions'

import { useRowImport, type UseRowImportArgs } from './use-row-import'

type Payload = { name: string }
const PAYLOAD: Payload = { name: 'Kael' }

function args(overrides: Partial<UseRowImportArgs<Payload>> = {}): UseRowImportArgs<Payload> {
  return {
    blocked: false,
    guard: vi.fn((proceed: () => void) => proceed()),
    select: vi.fn(),
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
  it('commits the validated payload, selects the new row through the guard, then reports it', async () => {
    const initial = args()
    const { result } = setup(initial)
    act(() => result.current.onValidated(PAYLOAD))
    await vi.waitFor(() => expect(initial.onImported).toHaveBeenCalledTimes(1))
    expect(initial.commit).toHaveBeenCalledWith(PAYLOAD)
    expect(initial.guard).toHaveBeenCalledTimes(1)
    expect(initial.select).toHaveBeenCalledWith('char_new')
    expect(initial.onImported).toHaveBeenCalledWith()
    expect(vi.mocked(initial.select).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(initial.onImported).mock.invocationCallOrder[0],
    )
    expect(initial.onRejected).not.toHaveBeenCalled()
    expect(initial.onFailed).not.toHaveBeenCalled()
  })

  it('selects nothing while the guard withholds proceed, and still reports the import', async () => {
    let release = () => {}
    const initial = args({
      guard: vi.fn((proceed: () => void) => {
        release = proceed
      }),
    })
    const { result } = setup(initial)
    act(() => result.current.onValidated(PAYLOAD))
    await vi.waitFor(() => expect(initial.onImported).toHaveBeenCalledTimes(1))
    expect(initial.guard).toHaveBeenCalledTimes(1)
    expect(initial.select).not.toHaveBeenCalled()
    act(() => release())
    expect(initial.select).toHaveBeenCalledWith('char_new')
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

  it('calls the callbacks from the latest render when the commit resolves', async () => {
    let finish: (r: ImportRowResult) => void = () => {}
    const initial = args({
      commit: vi.fn(
        () =>
          new Promise<ImportRowResult>((resolve) => {
            finish = resolve
          }),
      ),
    })
    const { result, rerender } = setup(initial)
    act(() => result.current.onValidated(PAYLOAD))
    await vi.waitFor(() => expect(initial.commit).toHaveBeenCalledTimes(1))
    const next = {
      ...initial,
      guard: vi.fn((proceed: () => void) => proceed()),
      select: vi.fn(),
      onImported: vi.fn(),
      onRejected: vi.fn(),
      onFailed: vi.fn(),
    }
    rerender(next)
    finish({ status: 'ok', id: 'char_new' })
    await vi.waitFor(() => expect(next.onImported).toHaveBeenCalledTimes(1))
    expect(next.guard).toHaveBeenCalledTimes(1)
    expect(next.select).toHaveBeenCalledWith('char_new')
    expect(initial.guard).not.toHaveBeenCalled()
    expect(initial.select).not.toHaveBeenCalled()
    expect(initial.onImported).not.toHaveBeenCalled()
  })

  it('routes a refusal and a failure to the latest callbacks too', async () => {
    let finish: (r: ImportRowResult) => void = () => {}
    let fail: (e: unknown) => void = () => {}
    const initial = args({
      commit: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<ImportRowResult>((resolve) => {
              finish = resolve
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise<ImportRowResult>((_, reject) => {
              fail = reject
            }),
        ),
    })
    const { result, rerender } = setup(initial)
    act(() => result.current.onValidated(PAYLOAD))
    act(() => result.current.onValidated(PAYLOAD))
    await vi.waitFor(() => expect(initial.commit).toHaveBeenCalledTimes(2))
    const next = { ...initial, onImported: vi.fn(), onRejected: vi.fn(), onFailed: vi.fn() }
    rerender(next)
    finish({ status: 'rejected', reason: 'generation in flight', code: 'in-flight' })
    const failure = new Error('boom')
    fail(failure)
    await vi.waitFor(() => expect(next.onRejected).toHaveBeenCalledWith('in-flight'))
    await vi.waitFor(() => expect(next.onFailed).toHaveBeenCalledWith(failure))
    expect(initial.onRejected).not.toHaveBeenCalled()
    expect(initial.onFailed).not.toHaveBeenCalled()
  })
})

describe('useRowImport — a throw after an ok commit', () => {
  // A listener of our own makes vitest leave the expected rejection to the test.
  const rejections: unknown[] = []
  const onRejection = (reason: unknown) => {
    rejections.push(reason)
  }
  beforeEach(() => {
    rejections.length = 0
    process.on('unhandledRejection', onRejection)
  })
  afterEach(() => {
    process.off('unhandledRejection', onRejection)
  })

  it.each(['select', 'onImported'] as const)(
    'surfaces a throw from %s instead of handing it to onFailed',
    async (name) => {
      const boom = new Error(`${name} threw`)
      const throwing = vi.fn(() => {
        throw boom
      })
      const initial = args(name === 'select' ? { select: throwing } : { onImported: throwing })
      const { result } = setup(initial)
      act(() => result.current.onValidated(PAYLOAD))
      await vi.waitFor(() => expect(throwing).toHaveBeenCalledTimes(1))
      expect(initial.onFailed).not.toHaveBeenCalled()
      await vi.waitFor(() => expect(rejections).toEqual([boom]))
      expect(initial.onFailed).not.toHaveBeenCalled()
    },
  )
})
