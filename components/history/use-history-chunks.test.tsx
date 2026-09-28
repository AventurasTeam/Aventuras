// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Delta } from '@/lib/db'
import type { HistoryChunk, HistoryQuery } from '@/lib/history'

import { HistoryLoaderProvider } from './history-loader'
import { useHistoryChunks } from './use-history-chunks'

const row = (logPosition: number) => ({ id: `delta_${logPosition}`, logPosition }) as Delta

function setup() {
  const load = vi.fn(
    async (query: HistoryQuery): Promise<HistoryChunk> =>
      query.cursor == null
        ? { rows: [row(4), row(3)], nextCursor: 3 }
        : { rows: [row(2)], nextCursor: null },
  )
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

afterEach(cleanup)

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
})
