import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import type { StorySettings } from '@/lib/db'
import { __resetBus, __resetRegistry, CHAPTER_CLOSE_KIND } from '@/lib/pipeline'
import { within } from '@/lib/pipeline/__tests__/harness'
import {
  openCloseFixture,
  setClassifierStatus,
  type CloseFixture,
} from '@/lib/pipeline/definitions/__tests__/close-fixture'
import { currentStoryStore, generationStore, resetAllStores } from '@/lib/stores'

import { runOwedClose } from './run-owed-close'
import { registerStandInClose, type StandInClose } from '../turns/__tests__/stand-in-close'
import {
  recordDeferred,
  registerStandInPass,
  type StandInPass,
} from '../turns/__tests__/stand-in-pass'

let f: CloseFixture
let pass: StandInPass
let close: StandInClose

beforeEach(async () => {
  __resetRegistry()
  __resetBus()
  f = await openCloseFixture()
  pass = registerStandInPass({ anchorEntryId: null })
  close = registerStandInClose()
})

afterEach(() => {
  resetAllStores()
})

const tailPosition = (): number => f.entries.at(-1)!.position

function patchSettings(patch: Partial<StorySettings>): void {
  const open = currentStoryStore.getCurrentStory()
  if (open == null) throw new Error('story not open')
  currentStoryStore.set({ ...open, settings: { ...open.settings, ...patch } })
}

// openCloseFixture counts every entry from its prose, so a threshold of 1 owes a close.
function oweByThreshold(): void {
  patchSettings({ chapterAutoClose: true, chapterTokenThreshold: 1 })
}

// The last turn's action and reply sit past the watermark.
const leaveLastTurnUnprocessed = () =>
  setClassifierStatus(f, { state: 'idle', processedThrough: tailPosition() - 2 })

describe('runOwedClose refusals', () => {
  it('refuses a branch that is not the open story’s', async () => {
    oweByThreshold()
    expect(await runOwedClose('br_elsewhere', f.ctx)).toEqual({
      outcome: 'rejected',
      blockedBy: 'branch-not-open',
    })
    currentStoryStore.__reset()
    expect(await runOwedClose(f.branchId, f.ctx)).toEqual({
      outcome: 'rejected',
      blockedBy: 'branch-not-open',
    })
    expect(pass.runs).toHaveLength(0)
    expect(close.runs).toHaveLength(0)
  })

  // The next Send fails as held first, so a Retry here must not settle as nothing to close.
  it('refuses a held branch as held when no close is owed', async () => {
    patchSettings({ chapterAutoClose: false })
    await setClassifierStatus(f, { state: 'running', processedThrough: tailPosition() })

    expect(await within(runOwedClose(f.branchId, f.ctx), 'the Retry')).toEqual({
      outcome: 'rejected',
      blockedBy: 'classifier-held',
    })
    expect(pass.runs).toHaveLength(0)
    expect(close.runs).toHaveLength(0)
  })

  it('refuses a held branch as held, starting nothing', async () => {
    oweByThreshold()
    await setClassifierStatus(f, { state: 'running', processedThrough: tailPosition() })

    expect(await within(runOwedClose(f.branchId, f.ctx), 'the Retry')).toEqual({
      outcome: 'rejected',
      blockedBy: 'classifier-held',
    })
    expect(pass.runs).toHaveLength(0)
    expect(close.runs).toHaveLength(0)
  })
})

describe('runOwedClose runs', () => {
  it('runs nothing when no close is owed any more', async () => {
    patchSettings({ chapterAutoClose: false })

    expect(await within(runOwedClose(f.branchId, f.ctx), 'the Retry')).toEqual({
      outcome: 'nothing-owed',
    })
    expect(generationStore.getTxState().runs.size).toBe(0)
    expect(close.runs).toHaveLength(0)
  })

  // As Send's own check does: a rollback below the threshold took back the interrupted close.
  it('clears a stale deferred close when no close is owed, keeping a deferred pass', async () => {
    patchSettings({ chapterAutoClose: false })
    recordDeferred('close', f)
    recordDeferred('pass', f)

    expect(await within(runOwedClose(f.branchId, f.ctx), 'the Retry')).toEqual({
      outcome: 'nothing-owed',
    })
    expect(generationStore.getTxState().deferred.get(f.branchId)).toEqual({ pass: true })
  })

  // startCloseChain would start a pass here: the owed check must come first.
  it('starts no pass over unprocessed entries when no close is owed', async () => {
    patchSettings({ chapterAutoClose: false })
    await leaveLastTurnUnprocessed()

    expect(await within(runOwedClose(f.branchId, f.ctx), 'the Retry')).toEqual({
      outcome: 'nothing-owed',
    })
    expect(pass.runs).toHaveLength(0)
  })

  it('closes at once when nothing is left to process', async () => {
    oweByThreshold()

    const pending = runOwedClose(f.branchId, f.ctx)
    const held = await within(close.nextHeld(), 'the close')
    expect(pass.runs).toHaveLength(0)
    held.finish('completed')

    expect(await within(pending, 'the Retry')).toMatchObject({
      outcome: 'ran',
      end: {
        kind: CHAPTER_CLOSE_KIND,
        result: { actionId: held.actionId, outcome: 'completed' },
        cancelled: false,
      },
    })
  })

  // Not alone: the pass it starts chains to the close.
  it('runs the catch-up pass first, which chains the close', async () => {
    oweByThreshold()
    await leaveLastTurnUnprocessed()

    const pending = runOwedClose(f.branchId, f.ctx)
    const passHeld = await within(pass.nextHeld(), 'the catch-up pass')
    expect(close.runs).toHaveLength(0)
    passHeld.finish('completed')
    const closeHeld = await within(close.nextHeld(), 'the chained close')
    closeHeld.finish('completed')

    expect(await within(pending, 'the Retry')).toMatchObject({
      outcome: 'ran',
      end: {
        kind: CHAPTER_CLOSE_KIND,
        result: { actionId: closeHeld.actionId, outcome: 'completed' },
      },
    })
    expect(pass.runs).toHaveLength(1)
    expect(closeHeld.actionId).not.toBe(passHeld.actionId)
  })

  it('closes for a standing pick with auto-close off, the commit clearing the pick', async () => {
    patchSettings({ chapterAutoClose: false })
    generationStore.setPendingClose(f.branchId, { endEntryId: f.replyIds[2]! })

    const pending = runOwedClose(f.branchId, f.ctx)
    const held = await within(close.nextHeld(), 'the close')
    held.finish('completed')

    expect(await within(pending, 'the Retry')).toMatchObject({
      outcome: 'ran',
      end: { kind: CHAPTER_CLOSE_KIND, result: { outcome: 'completed' } },
    })
    expect(generationStore.getTxState().pendingClose.has(f.branchId)).toBe(false)
  })

  it("ends on the close's failure", async () => {
    oweByThreshold()

    const pending = runOwedClose(f.branchId, f.ctx)
    const held = await within(close.nextHeld(), 'the close')
    held.finish('failed')

    expect(await within(pending, 'the Retry')).toMatchObject({
      outcome: 'ran',
      end: {
        kind: CHAPTER_CLOSE_KIND,
        result: { outcome: 'failed', error: { kind: 'phase-logic' } },
      },
    })
  })

  it('ends on a failed catch-up pass, starting no close', async () => {
    oweByThreshold()
    await leaveLastTurnUnprocessed()

    const pending = runOwedClose(f.branchId, f.ctx)
    const held = await within(pass.nextHeld(), 'the catch-up pass')
    held.finish('failed')

    expect(await within(pending, 'the Retry')).toMatchObject({
      outcome: 'ran',
      end: { kind: PERIODIC_CLASSIFIER_KIND, result: { outcome: 'failed' } },
    })
    expect(close.runs).toHaveLength(0)
  })
})
