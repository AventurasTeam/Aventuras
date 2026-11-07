import {
  asSchema,
  tool,
  type AssistantModelMessage,
  type FinishReason,
  type LanguageModelUsage,
  type ModelMessage,
  type ToolModelMessage,
  type ToolSet,
} from 'ai'
import { z } from 'zod'

import { boundedSignal } from '@/lib/abort'
import { logger } from '@/lib/diagnostics'

import type { ResolveTarget } from './agents'
import { anthropicCacheMarkerMiddleware } from './cache-marker'
import { callTimeoutMs } from './call-timeout'
import type { ContextWindowFailure } from './context-window'
import {
  carriedCapabilities,
  marksSystemPrefix,
  prepareGeneration,
  promptParams,
  windowCheck,
  withMiddleware,
  type PromptHalves,
  type StructuredCallOptions,
} from './generate'
import { ReplyCutOffError, replyCutOff, type ReplyCutOffFailure } from './reply-cut-off'
import type { ResolveFailureKind, ResolveModelConfig } from './resolve-model'
import {
  callWithRetry,
  type CallRetryError,
  type CallWithRetryResult,
} from './transport/call-with-retry'
import { runProviderCall } from './transport/provider-call'
import { checkInputTokens } from './truncation-check'

/** memory/chapter-close.md → When a task stops: a step's output when the profile sets none. */
export const TOOL_STEP_MAX_OUTPUT_DEFAULT = 8_000

/** No `execute`: the SDK would run the calls itself, in parallel, where a phase can't yield. */
export type ToolStepTool = { description: string; inputSchema: z.ZodObject; execute?: never }

export type ToolStepRequest = {
  /** The pair, sent first (architecture.md → System and user halves). */
  prompt: PromptHalves
  /** What follows the pair: earlier steps and their answers. */
  messages: readonly ModelMessage[]
  tools: Readonly<Record<string, ToolStepTool>>
  /** The task's first call: a window failure fails it instead of stopping the task. */
  firstCall: boolean
}

export type ToolStepCall = { toolCallId: string; toolName: string; input: Record<string, unknown> }
export type ToolStepInvalidCall = { toolCallId: string; toolName: string; detail: string }

export type ToolStep = {
  /** The valid calls, in the model's order; the caller answers these. */
  calls: readonly ToolStepCall[]
  /** A malformed call or an unknown tool; the SDK already answered each in `responseMessages`. */
  invalidCalls: readonly ToolStepInvalidCall[]
  /** As the SDK returned them, reasoning included, for the next step to send back. */
  responseMessages: readonly (AssistantModelMessage | ToolModelMessage)[]
  text: string
  /** A cut or filtered reply is never a step. */
  finishReason: Exclude<FinishReason, 'length' | 'content-filter'>
  usage: LanguageModelUsage
}

export type ToolStepResult =
  | { status: 'ok'; step: ToolStep; recoverable: readonly CallRetryError[] }
  | {
      status: 'stopped'
      reason: 'cut-off'
      failure: ReplyCutOffFailure
      recoverable: readonly CallRetryError[]
    }
  | {
      status: 'stopped'
      reason: 'window'
      failure: ContextWindowFailure
      recoverable: readonly CallRetryError[]
    }
  | {
      status: 'failed'
      /** A second cut stops the task instead. */
      error: Exclude<CallRetryError, { tier: 'reply-cut-off' }>
      recoverable: readonly CallRetryError[]
    }
  | { status: 'not-configured'; kind: ResolveFailureKind }
  | { status: 'aborted'; recoverable: readonly CallRetryError[] }

type StepReply = Awaited<ReturnType<typeof runProviderCall>>

type Run = { result: CallWithRetryResult<ToolStep>; expired: boolean }

// The SDK's own conversion, run first, else it throws inside the call as a provider error; the
// output side refuses a transform, whose value the SDK returns as the call's input.
async function sdkTools(
  defs: ToolStepRequest['tools'],
): Promise<{ tools: ToolSet } | { detail: string }> {
  const tools: ToolSet = {}
  for (const [name, { description, inputSchema }] of Object.entries(defs)) {
    try {
      await asSchema(inputSchema).jsonSchema
      z.toJSONSchema(inputSchema)
    } catch (error) {
      return { detail: `tool ${name}: ${error instanceof Error ? error.message : String(error)}` }
    }
    tools[name] = tool({ description, inputSchema })
  }
  return { tools }
}

function stepOf(reply: StepReply, finishReason: ToolStep['finishReason']): ToolStep {
  return {
    calls: reply.toolCalls
      .filter((call) => call.invalid !== true)
      .map(({ toolCallId, toolName, input }) => ({ toolCallId, toolName, input })),
    invalidCalls: reply.toolCalls
      .filter((call) => call.invalid === true)
      .map(({ toolCallId, toolName, error }) => ({
        toolCallId,
        toolName,
        detail: error instanceof Error ? error.message : String(error),
      })),
    responseMessages: reply.response.messages,
    text: reply.text,
    finishReason,
    usage: reply.usage,
  }
}

// Anthropic's adapter adds the thinking budget and clamps to the model's cap; openai-compatible's
// body is a string, and its max_tokens is maxOutput unchanged.
function sentMaxOutput(reply: StepReply, maxOutput: number): number {
  const { body } = reply.request
  return typeof body === 'object' &&
    body !== null &&
    'max_tokens' in body &&
    typeof body.max_tokens === 'number'
    ? body.max_tokens
    : maxOutput
}

/**
 * One step of a close's task (memory/chapter-close.md → The agent); calls come back unrun.
 */
export async function generateToolStep(
  target: ResolveTarget,
  request: ToolStepRequest,
  config: ResolveModelConfig,
  signal: AbortSignal,
  options: StructuredCallOptions,
): Promise<ToolStepResult> {
  const resolved = prepareGeneration(target, config, options.actionId ?? undefined)
  if (!resolved.ok) return { status: 'not-configured', kind: resolved.kind }
  const { providerId, modelId } = resolved
  const attribution = options.actionId === null ? undefined : { actionId: options.actionId }

  const prepared = await sdkTools(request.tools)
  if ('detail' in prepared) {
    return {
      status: 'failed',
      error: { tier: 'parse', detail: prepared.detail, attempt: 0 },
      recoverable: [],
    }
  }
  const { tools } = prepared
  // A story override resolves to no profile params, so it takes the default too.
  const maxOutput = resolved.params.maxOutput ?? TOOL_STEP_MAX_OUTPUT_DEFAULT
  const check = windowCheck(config.providers, providerId, modelId, attribution)
  const sent = carriedCapabilities()
  const model = withMiddleware(resolved.model, [
    ...(marksSystemPrefix(options.cacheSystemPrefix, resolved.providerType)
      ? [anthropicCacheMarkerMiddleware()]
      : []),
    sent.middleware,
    check.middleware,
  ])
  const halves = promptParams(request.prompt)
  // The SDK takes `prompt` or `messages`, not both, so the user half opens the messages.
  const messages: ModelMessage[] = [{ role: 'user', content: halves.prompt }, ...request.messages]

  const callFn = async (sig: AbortSignal): Promise<StepReply> => {
    const reply = await runProviderCall({
      model,
      ...(halves.system === undefined ? {} : { system: halves.system }),
      messages,
      tools,
      abortSignal: sig,
      ...resolved.callSettings,
      maxOutputTokens: maxOutput,
    })
    checkInputTokens({
      usage: reply.usage,
      estimate: check.estimate(),
      providerId,
      modelId,
      ...attribution,
    })
    return reply
  }

  // generation-pipeline.md → Cut-off replies: a cut or filtered reply is never a step, whatever it
  // holds, so its calls and messages never reach the caller.
  const parse = (reply: StepReply): ToolStep => {
    const { finishReason } = reply
    if (finishReason === 'length' || finishReason === 'content-filter') {
      throw new ReplyCutOffError(
        replyCutOff({
          stop: finishReason,
          usage: reply.usage,
          maxOutput: sentMaxOutput(reply, maxOutput),
          window: check.window.tokens,
          promptEstimate: check.estimate(),
          providerId,
          modelId,
        }),
      )
    }
    return stepOf(reply, finishReason)
  }

  const boundMs = callTimeoutMs(target, config)
  const run = async (): Promise<Run> => {
    const bounded = boundedSignal(signal, boundMs)
    try {
      const result = await callWithRetry(callFn, parse, {
        maxProviderAttempts: 2,
        maxParseAttempts: 1,
        signal: bounded.signal,
        carried: sent.carried,
      })
      return { result, expired: bounded.expired() }
    } finally {
      bounded.dispose()
    }
  }

  const failedOutcome = (
    error: CallRetryError,
    recoverable: readonly CallRetryError[],
  ): ToolStepResult => {
    if (error.tier === 'context-window') {
      const { tier: _tier, ...failure } = error
      logger.warn('provider.context_window', { target, ...failure }, attribution)
      // architecture.md → The pre-send check: only a task's first call not fitting fails the close.
      return request.firstCall
        ? { status: 'failed', error, recoverable }
        : { status: 'stopped', reason: 'window', failure, recoverable }
    }
    // Only the retry's cut reaches here; the first run's is retried before outcome().
    if (error.tier === 'reply-cut-off') {
      const { tier: _tier, ...failure } = error
      logger.warn('provider.reply_cut_off', { outcome: 'stopped', target, ...failure }, attribution)
      return { status: 'stopped', reason: 'cut-off', failure, recoverable }
    }
    return { status: 'failed', error, recoverable }
  }

  const outcome = (
    { result, expired }: Run,
    recoverable: readonly CallRetryError[],
  ): ToolStepResult => {
    switch (result.status) {
      case 'ok':
        return { status: 'ok', step: result.result, recoverable }
      case 'failed':
        return failedOutcome(result.error, recoverable)
      case 'aborted':
        // An expiry aborts the run as a cancel does, but fails the step (classifier.md → Failure
        // policy), with the detail lib/pipeline gives a pass's.
        return expired
          ? {
              status: 'failed',
              error: {
                tier: 'provider',
                reason: 'timeout',
                detail: `${target}: timeout after ${boundMs}ms`,
              },
              recoverable,
            }
          : { status: 'aborted', recoverable }
    }
  }

  const first = await run()
  if (first.result.status !== 'failed' || first.result.error.tier !== 'reply-cut-off') {
    return outcome(first, first.result.recoverable)
  }
  // Once more, under a bound of its own: a cut attempt likely spent most of its run's bound
  // (memory/chapter-close.md → When a task stops).
  const cut = first.result.error
  const { tier: _tier, ...cutFailure } = cut
  logger.warn('provider.reply_cut_off', { outcome: 'retried', target, ...cutFailure }, attribution)
  const retry = await run()
  return outcome(retry, [...first.result.recoverable, cut, ...retry.result.recoverable])
}
