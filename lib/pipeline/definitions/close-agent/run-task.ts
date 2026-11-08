import type { JSONValue, ModelMessage, ToolModelMessage } from 'ai'

import type { GroupOutcome } from '@/lib/actions/types'
import { generateToolStep, type ResolveTarget, type ToolStepCall } from '@/lib/ai'

import { createReadSet } from './common-checks'
import { dispatchToolCall, type DispatchContext, type ToolAnswer } from './dispatch'
import type { CloseIds } from './ids'
import type { CloseTaskDef, TaskRunContext } from './task'
import { toolStepTools } from './tool'
import { modelAnswer } from './verdict'
import { retriedAttemptEvents, toPipelineError } from '../../call-error'
import type { PhaseEmittedEvent, PipelineError } from '../../types'
import { CLOSE_PHASE } from '../intermediates'

const TARGET = 'lore-mgmt' satisfies ResolveTarget

/** chapter-close.md → When a task stops: the steps a task gets per part, tuned in play. */
export const CLOSE_TASK_STEP_BUDGET = 24

export type TaskEnd =
  | { status: 'finished' }
  | { status: 'stopped'; reason: 'budget' | 'window' | 'cut-off' }
  | { status: 'aborted' }
  | { status: 'failed'; error: PipelineError }

type StopReason = Extract<TaskEnd, { status: 'stopped' }>['reason']

function toolMessage(answers: readonly ToolAnswer[]): ToolModelMessage {
  return {
    role: 'tool',
    content: answers.map(({ toolCallId, toolName, output }) => ({
      type: 'tool-result' as const,
      toolCallId,
      toolName,
      output:
        typeof output === 'string'
          ? { type: 'text' as const, value: output }
          : { type: 'json' as const, value: output as JSONValue },
    })),
  }
}

// chapter-close.md → Conversations (closeTools): code refuses a tool outside the task and says so.
function outsideTask(call: ToolStepCall, ids: CloseIds): ToolAnswer {
  return {
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    output: modelAnswer(
      {
        result: 'rejected',
        reason: `${call.toolName} is not one of this task's tools`,
        landed: [],
        skippedFields: [],
      },
      {},
      ids,
    ),
  }
}

/**
 * chapter-close.md → Conversations: one task in its own conversation, until a reply calls no
 * tool, the budget runs out or a step stops it. Every step carries the cache marker.
 */
export async function* runCloseTask(
  def: CloseTaskDef,
  ctx: TaskRunContext,
): AsyncGenerator<PhaseEmittedEvent, TaskEnd, GroupOutcome | undefined> {
  // The guard reads ctx.phase's db and branch, so the tools must read the same ones.
  const taskCtx: TaskRunContext = {
    ...ctx,
    db: ctx.phase.db,
    branchId: ctx.phase.branchId,
    task: def.task,
    readFields: def.readFields,
  }
  const start = await def.start(taskCtx)
  if (start === null) return { status: 'finished' }
  // Per task and part: a row read in one task is unread in the next.
  const readSet = createReadSet()
  readSet.add(start.seeds)
  const dispatch: DispatchContext = { ...taskCtx, readSet }
  const prompt = def.render(start, { ...taskCtx, writesSoFar: ctx.ledger.writesSoFar(ctx.ids) })
  const tools = toolStepTools(def.tools)
  const byName = new Map(def.tools.map((tool) => [tool.name, tool]))
  const messages: ModelMessage[] = []
  const stop = (reason: StopReason): TaskEnd => {
    ctx.ledger.stop({ task: def.task, part: ctx.part, reason })
    return { status: 'stopped', reason }
  }

  for (let step = 1; step <= CLOSE_TASK_STEP_BUDGET; step++) {
    if (ctx.phase.abortSignal.aborted) return { status: 'aborted' }
    const result = await generateToolStep(
      TARGET,
      { prompt, messages: [...messages], tools, firstCall: step === 1 },
      ctx.config,
      ctx.phase.abortSignal,
      { actionId: ctx.phase.actionId, cacheSystemPrefix: true },
    )
    yield* retriedAttemptEvents(result, TARGET)
    if (result.status === 'not-configured')
      return {
        status: 'failed',
        error: {
          kind: 'config-resolver',
          failure: result.kind,
          target: TARGET,
          phaseName: CLOSE_PHASE.agent,
        },
      }
    if (result.status === 'failed')
      return { status: 'failed', error: toPipelineError(result.error, TARGET) }
    if (result.status === 'aborted') return { status: 'aborted' }
    if (result.status === 'stopped') return stop(result.reason)

    const { calls, invalidCalls, responseMessages } = result.step
    if (calls.length === 0 && invalidCalls.length === 0) return { status: 'finished' }
    ctx.ledger.noteToolCall()
    messages.push(...responseMessages)
    const answers: ToolAnswer[] = []
    for (const call of calls) {
      if (ctx.phase.abortSignal.aborted) return { status: 'aborted' }
      const tool = byName.get(call.toolName)
      if (tool === undefined) answers.push(outsideTask(call, ctx.ids))
      else answers.push(yield* dispatchToolCall(call, tool, dispatch))
    }
    // The SDK merges this with its own answers to invalid calls into one tool message.
    if (answers.length > 0) messages.push(toolMessage(answers))
  }
  return stop('budget')
}
