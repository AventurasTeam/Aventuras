import type { JSONValue, ModelMessage, ToolModelMessage } from 'ai'

import type { GroupOutcome } from '@/lib/actions/types'
import { generateToolStep, type ResolveTarget, type ToolStep, type ToolStepCall } from '@/lib/ai'

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

function isJsonValue(value: unknown): value is JSONValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (typeof value !== 'object') return false
  const proto: unknown = Object.getPrototypeOf(value)
  return (proto === Object.prototype || proto === null) && Object.values(value).every(isJsonValue)
}

// The SDK refuses a non-JSON tool result only when the next step builds its prompt, as a
// provider error; the fault is the tool's, so it fails here, naming the tool.
function resultOutput(
  toolName: string,
  output: unknown,
): { type: 'text'; value: string } | { type: 'json'; value: JSONValue } {
  if (typeof output === 'string') return { type: 'text', value: output }
  if (!isJsonValue(output))
    throw new Error(`close tool ${toolName} answered a value that isn't JSON`)
  return { type: 'json', value: output }
}

function toolMessage(answers: readonly ToolAnswer[]): ToolModelMessage {
  return {
    role: 'tool',
    content: answers.map(({ toolCallId, toolName, output }) => ({
      type: 'tool-result' as const,
      toolCallId,
      toolName,
      output: resultOutput(toolName, output),
    })),
  }
}

function callOrder(messages: readonly ModelMessage[]): Map<string, number> {
  const order = new Map<string, number>()
  for (const message of messages) {
    if (message.role !== 'assistant' || typeof message.content === 'string') continue
    for (const part of message.content)
      if (part.type === 'tool-call') order.set(part.toolCallId, order.size)
  }
  return order
}

// chapter-close.md → Conversations: the model's message goes back as returned, then one tool
// message in call order, since a template may label results by tool name alone, not call id.
function stepMessages(
  responseMessages: ToolStep['responseMessages'],
  answers: readonly ToolAnswer[],
): ModelMessage[] {
  const kept: ModelMessage[] = responseMessages.filter((message) => message.role !== 'tool')
  const sdkAnswers = responseMessages.filter((message) => message.role === 'tool')
  const parts = [
    ...sdkAnswers.flatMap((message) => message.content),
    ...(answers.length === 0 ? [] : toolMessage(answers).content),
  ]
  if (parts.length === 0) return kept
  const order = callOrder(kept)
  const rank = (part: ToolModelMessage['content'][number]): number =>
    (part.type === 'tool-result' ? order.get(part.toolCallId) : undefined) ?? order.size
  // Array sort is stable: an id outside the calls keeps its place after them.
  const content = [...parts].sort((a, b) => rank(a) - rank(b))
  // As the SDK's own merge does: the first tool message's provider options carry over.
  const providerOptions = sdkAnswers[0]?.providerOptions
  const tool: ToolModelMessage = {
    role: 'tool',
    content,
    ...(providerOptions === undefined ? {} : { providerOptions }),
  }
  const at = kept.findLastIndex((message) => message.role === 'assistant')
  return [...kept.slice(0, at + 1), tool, ...kept.slice(at + 1)]
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
  // The guard reads ctx.branchId with ctx.phase.db, and the orchestrator applies groups on the
  // phase's branch: a context that names another db or branch would split a write from its guard.
  if (ctx.db !== ctx.phase.db) throw new Error("runCloseTask: the context's db isn't the phase's")
  if (ctx.branchId !== ctx.phase.branchId)
    throw new Error("runCloseTask: the context's branch isn't the phase's")
  const taskCtx: TaskRunContext = { ...ctx, task: def.task, readFields: def.readFields }
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
    const answers: ToolAnswer[] = []
    for (const call of calls) {
      if (ctx.phase.abortSignal.aborted) return { status: 'aborted' }
      const tool = byName.get(call.toolName)
      if (tool === undefined) answers.push(outsideTask(call, ctx.ids))
      else answers.push(yield* dispatchToolCall(call, tool, dispatch))
    }
    messages.push(...stepMessages(responseMessages, answers))
  }
  // An abort raised inside the last step's calls is a cancel, not a spent budget.
  if (ctx.phase.abortSignal.aborted) return { status: 'aborted' }
  return stop('budget')
}
