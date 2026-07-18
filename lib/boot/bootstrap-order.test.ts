import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { APP_SETTINGS_DEFAULTS, APP_SETTINGS_SINGLETON_ID, appSettings } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { __resetDiagnosticsGate } from '@/lib/diagnostics'
import { recoverInFlightRuns } from '@/lib/pipeline'
import { rehydrateAppSettings, resetAllStores } from '@/lib/stores'

import { runBootstrap } from './bootstrap'

// Auto-spy both barrels (call-through), so the ordering assertion observes the
// real invocation sequence rather than just the source order. invocationCallOrder
// is a global monotonic counter; recovery is awaited before hydrate is called.
vi.mock('@/lib/pipeline', { spy: true })
vi.mock('@/lib/stores', { spy: true })

let ctx: Awaited<ReturnType<typeof createTestDb>>

beforeEach(async () => {
  ctx = await createTestDb()
  await ctx.db
    .insert(appSettings)
    .values({ id: APP_SETTINGS_SINGLETON_ID, ...APP_SETTINGS_DEFAULTS })
  __resetDiagnosticsGate()
})
afterEach(() => {
  resetAllStores()
  vi.clearAllMocks()
})

describe('runBootstrap phase ordering', () => {
  it('invokes-and-awaits crash recovery before settings hydration starts', async () => {
    const r = await runBootstrap(ctx)
    expect(r).toEqual({ status: 'ok' })

    const recoverOrder = vi.mocked(recoverInFlightRuns).mock.invocationCallOrder[0]
    const hydrateOrder = vi.mocked(rehydrateAppSettings).mock.invocationCallOrder[0]
    expect(recoverOrder).toBeGreaterThan(0)
    expect(hydrateOrder).toBeGreaterThan(recoverOrder)
  })
})
