import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { generateStructured } from '@/lib/ai'
import { chapters } from '@/lib/db'
import { __resetBus, __resetRegistry, CHAPTER_CLOSE_KIND } from '@/lib/pipeline'
import { resetSingletons, within } from '@/lib/pipeline/__tests__/harness'
import {
  metadataReplyResult,
  openCloseFixture,
  type CloseFixture,
} from '@/lib/pipeline/definitions/__tests__/close-fixture'
import { __setCloseAgentSlots, NO_CLOSE_TASKS } from '@/lib/pipeline/definitions/close-agent/slots'
import { appSettingsStore, generationStore, hydrateAppSettings } from '@/lib/stores'

import { runPickedClose } from './picked-close'

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateStructured: vi.fn(),
}))

let f: CloseFixture

beforeEach(async () => {
  vi.resetAllMocks()
  __resetRegistry()
  __resetBus()
  __setCloseAgentSlots(NO_CLOSE_TASKS)
  vi.mocked(generateStructured).mockResolvedValue(metadataReplyResult())
  f = await openCloseFixture()
})

afterEach(() => {
  __setCloseAgentSlots(undefined)
  resetSingletons()
})

const pickOn = () => generationStore.getTxState().pendingClose.get(f.branchId)

describe('runPickedClose', () => {
  it('closes on the pick, its end still naming the close', async () => {
    const pick = f.replyIds[2]!

    const run = await within(runPickedClose(f.branchId, pick, f.ctx), 'the Retry')

    expect(run).toMatchObject({
      outcome: 'ran',
      end: { kind: CHAPTER_CLOSE_KIND, result: { outcome: 'completed' } },
    })
    expect((await f.ctx.db.select().from(chapters)).map((row) => row.endEntryId)).toEqual([pick])
  })

  it('pre-flights again, handing back a failed one with nothing started', async () => {
    const settings = appSettingsStore.getAppSettings()
    const unassigned = { ...settings, assignments: { classifier: 'prof_close_classifier' } }
    expect(await hydrateAppSettings(async () => unassigned)).toEqual({ status: 'ok' })

    expect(await runPickedClose(f.branchId, f.replyIds[2]!, f.ctx)).toEqual({
      outcome: 'preflight-failed',
      error: {
        kind: 'config-resolver',
        failure: 'no-profile-assigned',
        target: 'lore-mgmt',
        phaseName: 'boundary',
      },
    })
    expect(pickOn()).toBeUndefined()
    expect(await f.ctx.db.select().from(chapters)).toEqual([])
  })

  it('refuses a pick that can no longer end a chapter', async () => {
    const action = f.entries.find((entry) => entry.kind === 'user_action')!

    expect(await runPickedClose(f.branchId, action.id, f.ctx)).toEqual({
      outcome: 'rejected',
      blockedBy: 'invalid-end',
    })
    expect(pickOn()).toBeUndefined()
  })
})
