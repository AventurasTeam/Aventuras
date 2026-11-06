import {
  asSchema,
  tool,
  type FinishReason,
  type LanguageModelUsage,
  type ModelMessage,
  type ToolSet,
} from 'ai'
import type { z } from 'zod'

import { boundedSignal } from '@/lib/abort'

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
import type { ReplyCutOffFailure } from './reply-cut-off'
import type { ResolveFailureKind, ResolveModelConfig } from './resolve-model'
import {
  callWithRetry,
  type CallRetryError,
  type CallWithRetryResult,
} from './transport/call-with-retry'
import { ProviderTimeoutError } from './transport/classify-provider-error'
import { runProviderCall } from './transport/provider-call'
import { checkInputTokens } from './truncation-check'

/** memory/chapter-close.md → When a task stops: a step's output when the profile sets none. */
export const TOOL_STEP_MAX_OUTPUT_DEFAULT = 8_000

/** No `execute`: the SDK would run the calls itself, in parallel, where a phase can't yield. */
export type ToolStepTool = { description: string; inputSchema: z.ZodType; execute?: never }

export type ToolStepRequest = {
  /** The pair, sent first (architecture.md → System and user halves). */
  prompt: PromptHalves
  /** What follows the pair: earlier steps and their answers. */
  messages: readonly ModelMessage[]
  tools: Readonly<Record<string, ToolStepTool>>
  /** The task's first call: a window failure fails it instead of stopping the task. */
  firstCall: boolean
}

export type ToolStepCall = { toolCallId: string; toolName: string; input: unknown }
export type ToolStepInvalidCall = { toolCallId: string; toolName: string; detail: string }

export type ToolStep = {
  /** The valid calls, in the model's order; the caller answers these. */
  calls: readonly ToolStepCall[]
  /** A malformed call or an unknown tool; the SDK already answered each in `responseMessages`. */
  invalidCalls: readonly ToolStepInvalidCall[]
  /** As the SDK returned them, reasoning included, for the next step to send back. */
  responseMessages: readonly ModelMessage[]
  text: string
  finishReason: FinishReason
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
  | { status: 'failed'; error: CallRetryError; recoverable: readonly CallRetryError[] }
  | { status: 'not-configured'; kind: ResolveFailureKind }
  | { status: 'aborted'; recoverable: readonly CallRetryError[] }

type StepReply = Awaited<ReturnType<typeof runProviderCall>>

type Run = { result: CallWithRetryResult<ToolStep>; expired: boolean }

// The schema conversion the SDK runs as it builds the request, run first: a schema with no JSON
// Schema form would otherwise throw inside the call and be retried as a provider error.
async function sdkTools(
  defs: ToolStepRequest['tools'],
): Promise<{ tools: ToolSet } | { detail: string }> {
  const tools: ToolSet = {}
  for (const [name, { description, inputSchema }] of Object.entries(defs)) {
    try {
      await asSchema(inputSchema).jsonSchema
    } catch (error) {
      return { detail: `tool ${name}: ${error instanceof Error ? error.message : String(error)}` }
    }
    tools[name] = tool({ description, inputSchema })
  }
  return { tools }
}

function stepOf(reply: StepReply): ToolStep {
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
    finishReason: reply.finishReason,
    usage: reply.usage,
  }
}

/**
 * One step of a close's task (memory/chapter-close.md → The agent): the pair, the conversation so
 * far and the tool list go out, and one reply comes back with its calls unrun.
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

  const attemptMs = resolved.timeoutMs
  const callFn = async (sig: AbortSignal): Promise<StepReply> => {
    // Per attempt, as generateStructured does; the run's bound, armed first, ends a retry first.
    const attempt = attemptMs === undefined ? null : boundedSignal(sig, attemptMs)
    try {
      const reply = await runProviderCall({
        model,
        ...(halves.system === undefined ? {} : { system: halves.system }),
        messages,
        tools,
        abortSignal: attempt?.signal ?? sig,
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
    } catch (error) {
      if (attempt?.expired()) throw new ProviderTimeoutError()
      throw error
    } finally {
      attempt?.dispose()
    }
  }

  const boundMs = callTimeoutMs(target, config)
  const run = async (): Promise<Run> => {
    const bounded = boundedSignal(signal, boundMs)
    try {
      const result = await callWithRetry(callFn, stepOf, {
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

  const outcome = (
    { result, expired }: Run,
    recoverable: readonly CallRetryError[],
  ): ToolStepResult => {
    switch (result.status) {
      case 'ok':
        return { status: 'ok', step: result.result, recoverable }
      case 'failed':
        return { status: 'failed', error: result.error, recoverable }
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
  return outcome(first, first.result.recoverable)
}
