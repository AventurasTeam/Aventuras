import { applyDeltaActionGroupWithOutcomes } from '@/lib/actions/delta/apply-delta-action'
import type { GroupOutcome } from '@/lib/actions/types'
import type { ResolveModelConfig, ToolStepCall, ToolStepResult } from '@/lib/ai'
import type { ChapterPartCut } from '@/lib/chapters'
import { makeLogger } from '@/lib/diagnostics'

import type { PhaseContext, PhaseEmittedEvent, PhaseResult } from '../../../types'
import { storeModelConfig, type CloseFixture } from '../../__tests__/close-fixture'
import { closeAgentPhase } from '../../chapter-close-agent'
import { setCloseModelConfig, setCloseParts, setCloseRange } from '../../close-intermediates'
import type { CloseRange } from '../../intermediates'

const USAGE = {
  inputTokens: 100,
  inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
  outputTokens: 5,
  outputTokenDetails: { textTokens: 5, reasoningTokens: 0 },
  totalTokens: 105,
}

// A step as the SDK returns it; no call ends the task.
export function stepWith(calls: readonly ToolStepCall[]): ToolStepResult {
  const text = calls.length === 0 ? 'Nothing to change.' : ''
  return {
    status: 'ok',
    step: {
      calls,
      invalidCalls: [],
      responseMessages: [
        {
          role: 'assistant',
          content:
            calls.length === 0
              ? [{ type: 'text', text }]
              : calls.map(({ toolCallId, toolName, input }) => ({
                  type: 'tool-call' as const,
                  toolCallId,
                  toolName,
                  input,
                })),
        },
      ],
      text,
      finishReason: calls.length === 0 ? 'stop' : 'tool-calls',
      usage: USAGE,
    },
    recoverable: [],
  }
}

/**
 * A close's phase context over `range`. `cuts` are the metadata phase's: one part over the range
 * unless given, none for `null`, as a run whose metadata phase never ran. `modelConfig` is the one
 * it parks: the stores' unless given, none for `null`.
 */
export function closePhaseContext(
  fixture: CloseFixture,
  opts: {
    actionId: string
    range: CloseRange
    cuts?: readonly ChapterPartCut[] | null
    modelConfig?: ResolveModelConfig | null
    abortSignal?: AbortSignal
  },
): PhaseContext {
  const { actionId, range, abortSignal = new AbortController().signal } = opts
  // The agent loop reads a cut's ids; its token count is the metadata phase's.
  const cuts =
    opts.cuts === undefined
      ? [{ part: 1, startEntryId: range.startEntryId, endEntryId: range.endEntryId, tokens: 0 }]
      : opts.cuts
  const modelConfig = opts.modelConfig === undefined ? storeModelConfig() : opts.modelConfig
  const intermediates: Record<string, unknown> = {}
  setCloseRange(intermediates, range)
  if (cuts !== null) setCloseParts(intermediates, cuts)
  if (modelConfig !== null) setCloseModelConfig(intermediates, modelConfig)
  return {
    actionId,
    abortSignal,
    intermediates,
    log: makeLogger(actionId),
    db: fixture.ctx.db,
    runInTransaction: fixture.ctx.runInTransaction,
    storyId: fixture.storyId,
    branchId: fixture.branchId,
  }
}

// Stands in for the orchestrator over a whole phase: each group lands in `fixture` and its outcome
// goes back, so a landed create counts toward a cap as it does in a close.
export async function drainApplying(
  ctx: PhaseContext,
  fixture: CloseFixture,
): Promise<{ events: PhaseEmittedEvent[]; result: PhaseResult }> {
  const gen = closeAgentPhase(ctx)
  const events: PhaseEmittedEvent[] = []
  let reply: GroupOutcome | undefined
  for (;;) {
    const next = await gen.next(reply)
    if (next.done) return { events, result: next.value }
    const event = next.value
    events.push(event)
    reply =
      event.type === 'delta_group_emitted'
        ? await applyDeltaActionGroupWithOutcomes(
            event.actions,
            { actionId: ctx.actionId, branchId: ctx.branchId, entryId: event.entryId },
            fixture.ctx,
          )
        : undefined
  }
}
