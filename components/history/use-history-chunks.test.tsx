// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Delta } from '@/lib/db'
import type { HistoryChunk, HistoryQuery } from '@/lib/history'
import { toast } from '@/lib/toast'

import { HistoryLoaderProvider, type HistoryLoader } from './history-loader'
import { useHistoryChunks } from './use-history-chunks'

const row = (logPosition: number) => ({ id: `delta_${logPosition}`, logPosition }) as Delta

const positions = (rows: readonly Delta[]) => rows.map((r) => r.logPosition)

function autoLoader() {
  return vi.fn(
    async (query: HistoryQuery): Promise<HistoryChunk> =>
      query.cursor == null
        ? { rows: [row(4), row(3)], nextCursor: 3 }
        : { rows: [row(2)], nextCursor: null },
  )
}

/** Each call waits until the test settles it, so responses can land out of order. */
function manualLoader() {
  const calls: {
    query: HistoryQuery
    resolve: (chunk: HistoryChunk) => void
    reject: (error: Error) => void
  }[] = []
  const load = vi.fn(
    (query: HistoryQuery) =>
      new Promise<HistoryChunk>((resolve, reject) => calls.push({ query, resolve, reject })),
  )
  return { load, calls }
}

function setup(load: HistoryLoader = autoLoader()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <HistoryLoaderProvider value={load}>{children}</HistoryLoaderProvider>
  )
  const version = {}
  const hook = renderHook(
    ({ search, version }: { search: string; version: object }) =>
      useHistoryChunks(
        { branchId: 'b1', targetTable: 'entities', targetId: 'char_1', search, sort: 'newest' },
        version,
      ),
    { wrapper, initialProps: { search: '', version } },
  )
  return { load, hook, version }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useHistoryChunks', () => {
  it('loads the first chunk once and appends the next only on loadMore', async () => {
    const { load, hook } = setup()
    await waitFor(() => expect(hook.result.current.status).toBe('ready'))
    expect(hook.result.current.rows.map((r) => r.logPosition)).toEqual([4, 3])
    expect(hook.result.current.hasMore).toBe(true)
    expect(load).toHaveBeenCalledTimes(1)

    act(() => hook.result.current.loadMore())
    await waitFor(() =>
      expect(hook.result.current.rows.map((r) => r.logPosition)).toEqual([4, 3, 2]),
    )
    expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 3 }))
    expect(hook.result.current.hasMore).toBe(false)
  })

  it('starts over from the first chunk when the query changes', async () => {
    const { load, hook, version } = setup()
    await waitFor(() => expect(hook.result.current.status).toBe('ready'))
    hook.rerender({ search: 'traits', version })
    await waitFor(() =>
      expect(load).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'traits', cursor: null }),
      ),
    )
    await waitFor(() => expect(hook.result.current.rows.map((r) => r.logPosition)).toEqual([4, 3]))
  })

  it('drops loaded chunks and reloads the first when the version changes', async () => {
    const { load, hook } = setup()
    await waitFor(() => expect(hook.result.current.status).toBe('ready'))
    act(() => hook.result.current.loadMore())
    await waitFor(() =>
      expect(hook.result.current.rows.map((r) => r.logPosition)).toEqual([4, 3, 2]),
    )

    hook.rerender({ search: '', version: {} })
    await waitFor(() => expect(hook.result.current.rows.map((r) => r.logPosition)).toEqual([4, 3]))
    expect(load).toHaveBeenCalledTimes(3)
    expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: null }))
  })

  it('shows loading with no rows while a changed query or version reloads (same-commit reset: ClearingASearch story)', async () => {
    const { load, calls } = manualLoader()
    const { hook, version } = setup(load)
    await waitFor(() => expect(calls).toHaveLength(1))
    await act(async () => calls[0].resolve({ rows: [row(4), row(3)], nextCursor: 3 }))
    expect(hook.result.current.status).toBe('ready')

    hook.rerender({ search: 'traits', version })
    expect(hook.result.current.status).toBe('loading')
    expect(hook.result.current.rows).toEqual([])
    expect(hook.result.current.hasMore).toBe(false)

    await act(async () => calls[1].resolve({ rows: [row(4)], nextCursor: null }))
    expect(hook.result.current.status).toBe('ready')
    hook.rerender({ search: 'traits', version: {} })
    expect(hook.result.current.status).toBe('loading')
    expect(hook.result.current.rows).toEqual([])
  })

  it('fails the first chunk, then retries it from the top', async () => {
    const { load, calls } = manualLoader()
    const { hook } = setup(load)
    await waitFor(() => expect(calls).toHaveLength(1))
    await act(async () => calls[0].reject(new Error('read failed')))
    expect(hook.result.current.status).toBe('failed')

    act(() => hook.result.current.retry())
    expect(hook.result.current.status).toBe('loading')
    expect(calls).toHaveLength(2)
    expect(calls[1].query.cursor).toBeNull()
    await act(async () => calls[1].resolve({ rows: [row(4)], nextCursor: null }))
    expect(positions(hook.result.current.rows)).toEqual([4])
  })

  it('keeps the newer first chunk when the superseded one resolves after it', async () => {
    const { load, calls } = manualLoader()
    const { hook, version } = setup(load)
    await waitFor(() => expect(calls).toHaveLength(1))
    hook.rerender({ search: 'traits', version })
    await waitFor(() => expect(calls).toHaveLength(2))

    await act(async () => calls[1].resolve({ rows: [row(9)], nextCursor: null }))
    await act(async () => calls[0].resolve({ rows: [row(4), row(3)], nextCursor: 3 }))
    expect(positions(hook.result.current.rows)).toEqual([9])
    expect(hook.result.current.hasMore).toBe(false)
  })

  it('drops a loadMore that resolves after the query changed', async () => {
    const { load, calls } = manualLoader()
    const { hook, version } = setup(load)
    await waitFor(() => expect(calls).toHaveLength(1))
    await act(async () => calls[0].resolve({ rows: [row(4), row(3)], nextCursor: 3 }))
    act(() => hook.result.current.loadMore())
    expect(calls[1].query.cursor).toBe(3)

    hook.rerender({ search: 'traits', version })
    await waitFor(() => expect(calls).toHaveLength(3))
    await act(async () => calls[2].resolve({ rows: [row(8)], nextCursor: 8 }))
    await act(async () => calls[1].resolve({ rows: [row(2)], nextCursor: null }))
    expect(positions(hook.result.current.rows)).toEqual([8])
    expect(hook.result.current.status).toBe('ready')

    act(() => hook.result.current.loadMore())
    expect(calls).toHaveLength(4)
    expect(calls[3].query).toMatchObject({ search: 'traits', cursor: 8 })
  })

  it('fires one load for two loadMore calls before a re-render', async () => {
    const { load, calls } = manualLoader()
    const { hook } = setup(load)
    await waitFor(() => expect(calls).toHaveLength(1))
    await act(async () => calls[0].resolve({ rows: [row(4), row(3)], nextCursor: 3 }))
    act(() => {
      hook.result.current.loadMore()
      hook.result.current.loadMore()
    })
    expect(calls).toHaveLength(2)
    await act(async () => calls[1].resolve({ rows: [row(2)], nextCursor: 2 }))
    expect(positions(hook.result.current.rows)).toEqual([4, 3, 2])

    act(() => hook.result.current.loadMore())
    expect(calls).toHaveLength(3)
    expect(calls[2].query.cursor).toBe(2)
  })

  it('keeps the loaded rows and toasts when a loadMore fails, then loads again', async () => {
    const toastError = vi.spyOn(toast, 'error')
    const { load, calls } = manualLoader()
    const { hook } = setup(load)
    await waitFor(() => expect(calls).toHaveLength(1))
    await act(async () => calls[0].resolve({ rows: [row(4), row(3)], nextCursor: 3 }))
    act(() => hook.result.current.loadMore())
    await act(async () => calls[1].reject(new Error('read failed')))
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(positions(hook.result.current.rows)).toEqual([4, 3])
    expect(hook.result.current.status).toBe('ready')

    act(() => hook.result.current.loadMore())
    expect(calls).toHaveLength(3)
    expect(calls[2].query.cursor).toBe(3)
  })

  it('stays silent when a loadMore fails after unmount', async () => {
    const toastError = vi.spyOn(toast, 'error')
    const { load, calls } = manualLoader()
    const { hook } = setup(load)
    await waitFor(() => expect(calls).toHaveLength(1))
    await act(async () => calls[0].resolve({ rows: [row(4), row(3)], nextCursor: 3 }))
    act(() => hook.result.current.loadMore())

    hook.unmount()
    await act(async () => calls[1].reject(new Error('read failed')))
    expect(toastError).not.toHaveBeenCalled()
  })
})
