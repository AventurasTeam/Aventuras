// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { MANUAL_CLOSE_REFUSAL } from '@/lib/actions'
import { logger } from '@/lib/diagnostics'
import { EMBEDDER_SWAP_REFUSAL } from '@/lib/embedder-swap'
import { t } from '@/lib/i18n'
import { CLASSIFIER_HELD, PER_TURN_KIND, type PipelineError } from '@/lib/pipeline'
import { toast } from '@/lib/toast'

import { runManualClose } from './run-manual-close'

// The close-failure copy's module also holds a hook on expo-router, which the unit project can't load.
vi.mock('expo-router', () => ({ useRouter: () => ({}) }))

const actions = vi.hoisted(() => ({ start: vi.fn(), raise: vi.fn() }))

vi.mock('@/lib/actions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  startManualClose: actions.start,
  raiseSystemEntry: actions.raise,
}))

const TOOL_OFF: PipelineError = {
  kind: 'config-resolver',
  failure: 'tool-calling-off',
  target: 'lore-mgmt',
  phaseName: 'agent',
  modelId: 'gemma-4-26b',
}

type RaiseArgs = {
  branchId: string
  content: string
  failure: (standing: { content: string; composerMode: string } | undefined) => unknown
}

let warn: MockInstance<typeof toast.warning>

beforeEach(() => {
  actions.start.mockReset()
  actions.raise.mockReset().mockResolvedValue('sys_1')
  warn = vi.spyOn(toast, 'warning').mockReturnValue('')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runManualClose', () => {
  it('starts the close on the confirmed end over the app database', async () => {
    actions.start.mockResolvedValue({ outcome: 'completed', runId: 'run_1', actionId: 'act_1' })
    await runManualClose('br_1', 'entry_65')
    expect(actions.start).toHaveBeenCalledWith('br_1', 'entry_65', {
      db: expect.anything(),
      runInTransaction: expect.any(Function),
    })
  })

  it.each([
    { outcome: 'completed', runId: 'run_1', actionId: 'act_1' },
    { outcome: 'aborted', runId: 'run_1', actionId: 'act_1' },
    {
      outcome: 'failed',
      runId: 'run_1',
      actionId: 'act_1',
      error: { kind: 'orchestrator', detail: 'x' },
    },
  ])("says nothing for a run that ended $outcome: the run's own surfaces speak", async (end) => {
    actions.start.mockResolvedValue(end)
    await runManualClose('br_1', 'entry_65')
    expect(warn).not.toHaveBeenCalled()
    expect(actions.raise).not.toHaveBeenCalled()
  })

  it.each([
    { blockedBy: MANUAL_CLOSE_REFUSAL.busy, key: 'reader:actions.blockedWhileGenerating' },
    { blockedBy: PER_TURN_KIND, key: 'reader:actions.blockedWhileGenerating' },
    { blockedBy: EMBEDDER_SWAP_REFUSAL, key: 'reader:actions.blockedWhileSwapping' },
    { blockedBy: CLASSIFIER_HELD, key: 'reader:systemEntry.closeRetryBlocked' },
    { blockedBy: MANUAL_CLOSE_REFUSAL.invalidEnd, key: 'reader:systemEntry.closeRetryBlocked' },
  ] as const)(
    'toasts the remedy for a start refused by $blockedBy, writing no entry',
    async ({ blockedBy, key }) => {
      actions.start.mockResolvedValue({ outcome: 'rejected', blockedBy })
      await runManualClose('br_1', 'entry_65')
      expect(warn).toHaveBeenCalledExactlyOnceWith(t(key))
      expect(actions.raise).not.toHaveBeenCalled()
    },
  )

  it('writes a failed pre-flight as the close-failure entry holding the pick, then toasts', async () => {
    actions.start.mockResolvedValue({ outcome: 'preflight-failed', error: TOOL_OFF })
    await runManualClose('br_1', 'entry_65')

    expect(actions.raise).toHaveBeenCalledOnce()
    const [args, ctx] = actions.raise.mock.calls[0] as [RaiseArgs, unknown]
    expect(args.branchId).toBe('br_1')
    // The can't-call-tools line names the model.
    expect(args.content).toContain('gemma-4-26b')
    expect(ctx).toEqual({ db: expect.anything(), runInTransaction: expect.any(Function) })
    // The entry keeps the confirmed end, which its Retry restarts.
    expect(args.failure(undefined)).toEqual({
      kind: 'config-resolver',
      failure: 'tool-calling-off',
      target: 'lore-mgmt',
      close: 'failed',
      closePick: 'entry_65',
    })
    // A failed Send's held text, read from the standing entry, carries across.
    const held = { content: 'I wade in.', composerMode: 'action' }
    expect(args.failure(held)).toEqual({
      kind: 'config-resolver',
      failure: 'tool-calling-off',
      target: 'lore-mgmt',
      close: 'failed',
      closePick: 'entry_65',
      submission: held,
    })
    expect(warn).toHaveBeenCalledExactlyOnceWith(t('chapters:closeModal.toast.preflightFailed'))
    expect(actions.raise.mock.invocationCallOrder[0]).toBeLessThan(
      warn.mock.invocationCallOrder[0]!,
    )
  })

  it.each([
    { name: 'the start throws', arrange: () => actions.start.mockRejectedValue(new Error('boom')) },
    {
      name: 'the entry write throws',
      arrange: () => {
        actions.start.mockResolvedValue({ outcome: 'preflight-failed', error: TOOL_OFF })
        actions.raise.mockRejectedValue(new Error('boom'))
      },
    },
  ])('logs and toasts a generic failure when $name, and never rejects', async ({ arrange }) => {
    arrange()
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    await expect(runManualClose('br_1', 'entry_65')).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith('app.manual_close_failed', {
      branchId: 'br_1',
      endEntryId: 'entry_65',
      error: 'boom',
    })
    expect(warn).toHaveBeenCalledExactlyOnceWith(t('chapters:closeModal.toast.startFailed'))
  })
})
