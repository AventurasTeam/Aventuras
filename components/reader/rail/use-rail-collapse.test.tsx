// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { APP_SETTINGS_DEFAULTS } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { appSettingsStore, hydrateAppSettings, readerRailStore } from '@/lib/stores'

import { useRailCollapse } from './use-rail-collapse'

const writeRailPreference = vi.hoisted(() => vi.fn())

vi.mock('@/lib/actions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  setReaderRailCollapsed: writeRailPreference,
}))

// The settings store re-hydrating from the row, as the real action does after a good write.
async function storeRailPreference(collapsed: boolean): Promise<void> {
  const result = await hydrateAppSettings(async () => ({
    ...APP_SETTINGS_DEFAULTS,
    appearance: { ...APP_SETTINGS_DEFAULTS.appearance, readerRailCollapsed: collapsed },
  }))
  expect(result).toEqual({ status: 'ok' })
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

// Records every collapsed value the instance renders.
function renderRecording(seen: boolean[]) {
  return renderHook(() => {
    const rail = useRailCollapse()
    seen.push(rail.collapsed)
    return rail
  })
}

beforeEach(() => {
  readerRailStore.__reset()
  appSettingsStore.__reset()
  writeRailPreference.mockReset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useRailCollapse', () => {
  it('reads the stored preference when nothing overrides it', async () => {
    await storeRailPreference(true)
    const { result } = renderHook(() => useRailCollapse())
    expect(result.current.collapsed).toBe(true)
  })

  // A good write whose re-hydrate failed (config-corrupt) resolves with the store still stale.
  it('keeps the toggle when the write resolves but the store still holds the old value', async () => {
    writeRailPreference.mockResolvedValue(undefined)
    const { result } = renderHook(() => useRailCollapse())
    expect(result.current.collapsed).toBe(false)

    act(() => result.current.setCollapsed(true))
    expect(result.current.collapsed).toBe(true)
    expect(writeRailPreference).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ runInTransaction: expect.any(Function) }),
    )

    await act(async () => {
      await writeRailPreference.mock.results[0].value
    })
    expect(readerRailStore.getDisplay().pendingCollapsed).toBe(true)
    expect(appSettingsStore.getAppSettings().appearance.readerRailCollapsed).toBe(false)
    expect(result.current.collapsed).toBe(true)
  })

  it('clears the pending value once the store catches up', async () => {
    writeRailPreference.mockResolvedValue(undefined)
    const { result } = renderHook(() => useRailCollapse())

    act(() => result.current.setCollapsed(true))
    expect(readerRailStore.getDisplay().pendingCollapsed).toBe(true)

    await act(async () => {
      await storeRailPreference(true)
    })
    await waitFor(() => expect(readerRailStore.getDisplay().pendingCollapsed).toBeNull())
    expect(result.current.collapsed).toBe(true)
  })

  it('holds the second of two quick toggles until both writes settle', async () => {
    const first = deferred()
    const secondRehydrate = deferred()
    const secondSettle = deferred()
    writeRailPreference
      .mockImplementationOnce(async (next: boolean) => {
        await first.promise
        await storeRailPreference(next)
      })
      .mockImplementationOnce(async (next: boolean) => {
        await secondRehydrate.promise
        await storeRailPreference(next)
        await secondSettle.promise
      })
    const { result } = renderHook(() => useRailCollapse())

    act(() => result.current.setCollapsed(true))
    act(() => result.current.setCollapsed(false))
    // The second toggle equals the still-old stored value; a write in flight keeps it pending.
    expect(result.current.collapsed).toBe(false)
    expect(readerRailStore.getDisplay().pendingCollapsed).toBe(false)

    // The first write lands in between: its re-hydrate must not show through.
    await act(async () => {
      first.resolve()
      await writeRailPreference.mock.results[0].value
    })
    expect(appSettingsStore.getAppSettings().appearance.readerRailCollapsed).toBe(true)
    expect(result.current.collapsed).toBe(false)
    expect(readerRailStore.getDisplay().pendingCollapsed).toBe(false)

    // The store matches again, but the second write is still in flight.
    await act(async () => {
      secondRehydrate.resolve()
      await Promise.resolve()
    })
    await waitFor(() =>
      expect(appSettingsStore.getAppSettings().appearance.readerRailCollapsed).toBe(false),
    )
    expect(result.current.collapsed).toBe(false)
    expect(readerRailStore.getDisplay().pendingCollapsed).toBe(false)

    await act(async () => {
      secondSettle.resolve()
      await writeRailPreference.mock.results[1].value
    })
    await waitFor(() => expect(readerRailStore.getDisplay().pendingCollapsed).toBeNull())
    expect(result.current.collapsed).toBe(false)
  })

  // Two stacked readers each mount the hook; the pending toggle they show is shared.
  it('keeps an expand on every instance when the collapse lands and the expand fails', async () => {
    const first = deferred()
    const second = deferred()
    writeRailPreference
      .mockImplementationOnce(async (next: boolean) => {
        await first.promise
        await storeRailPreference(next)
      })
      .mockImplementationOnce(async () => {
        await second.promise
        throw new Error('disk full')
      })
    const error = vi.spyOn(logger, 'error')
    const seen: boolean[] = []
    const front = renderRecording(seen)
    const back = renderRecording(seen)

    act(() => front.result.current.setCollapsed(true))
    act(() => front.result.current.setCollapsed(false))
    seen.length = 0

    await act(async () => {
      first.resolve()
      await writeRailPreference.mock.results[0].value
    })
    expect(appSettingsStore.getAppSettings().appearance.readerRailCollapsed).toBe(true)
    act(() => second.resolve())
    await waitFor(() => expect(error).toHaveBeenCalledTimes(1))

    expect(seen).not.toContain(true)
    expect(front.result.current.collapsed).toBe(false)
    expect(back.result.current.collapsed).toBe(false)
    expect(readerRailStore.getDisplay().pendingCollapsed).toBe(false)
  })

  it('retires the pending toggle once a retry after a failed write lands', async () => {
    writeRailPreference
      .mockRejectedValueOnce(new Error('disk full'))
      .mockImplementationOnce(async (next: boolean) => storeRailPreference(next))
    const error = vi.spyOn(logger, 'error')
    const { result } = renderHook(() => useRailCollapse())

    act(() => result.current.setCollapsed(true))
    await waitFor(() => expect(error).toHaveBeenCalledTimes(1))
    expect(readerRailStore.getDisplay().pendingCollapsed).toBe(true)

    act(() => result.current.setCollapsed(true))
    await act(async () => {
      await writeRailPreference.mock.results[1].value
    })
    expect(appSettingsStore.getAppSettings().appearance.readerRailCollapsed).toBe(true)
    await waitFor(() => expect(readerRailStore.getDisplay().pendingCollapsed).toBeNull())
    expect(result.current.collapsed).toBe(true)
  })

  it('keeps the toggled display and logs when the write fails', async () => {
    writeRailPreference.mockRejectedValue(new Error('disk full'))
    const error = vi.spyOn(logger, 'error')
    const { result } = renderHook(() => useRailCollapse())

    act(() => result.current.setCollapsed(true))
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith('reader.rail_pref_write_failed', {
        collapsed: true,
        error: 'disk full',
      }),
    )
    expect(result.current.collapsed).toBe(true)
    expect(readerRailStore.getDisplay().pendingCollapsed).toBe(true)
    expect(appSettingsStore.getAppSettings().appearance.readerRailCollapsed).toBe(false)
  })

  it('lets a manual expand beat a viewport-forced collapse', async () => {
    writeRailPreference.mockResolvedValue(undefined)
    readerRailStore.seedViewport(850)
    const { result } = renderHook(() => useRailCollapse())
    expect(result.current.collapsed).toBe(true)

    act(() => result.current.setCollapsed(false))
    expect(result.current.collapsed).toBe(false)
    expect(writeRailPreference).toHaveBeenCalledWith(false, expect.anything())
    await waitFor(() => expect(readerRailStore.getDisplay().pendingCollapsed).toBeNull())
    expect(result.current.collapsed).toBe(false)
  })
})
