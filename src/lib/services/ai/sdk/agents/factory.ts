/**
 * Agent Factory
 *
 * Creates ToolLoopAgent instances from preset configurations.
 * Integrates with the existing settings and provider system.
 */

import {
  ToolLoopAgent,
  wrapLanguageModel,
  type StopCondition,
  type ToolSet,
  type StepResult,
  type PrepareStepFunction,
  type ToolLoopAgentSettings,
} from 'ai'
import { settings } from '$lib/stores/settings.svelte'
import { resolvePresetModel, type ResolvedPreset } from '../presetResolution'
import { uniqueToolCallIdMiddleware } from '../middleware'
import { createLogger } from '$lib/log'

const log = createLogger('AgentFactory')

/**
 * Resolved configuration for creating an agent.
 *
 * The same thing `generate.ts` resolves -- it was declared separately while the resolution
 * was duplicated, and listed fewer fields than the function actually returned.
 */
export type ResolvedAgentConfig = ResolvedPreset

/**
 * Resolve preset → profile → model for agent creation.
 *
 * Shares `resolvePresetModel` with `generate.ts`; all this adds is the tool-call middleware.
 *
 * @param presetId - The preset ID (e.g., 'agentic', 'loreManagement')
 * @param serviceId - The Service ID
 * @param debugId - Request ID for debug logging
 */
function resolveAgentConfig(
  presetId: string,
  serviceId: string,
  debugId?: string,
): ResolvedAgentConfig {
  const resolved = resolvePresetModel({ presetId, serviceId, debugId })

  // Wrap with uniqueToolCallIdMiddleware so providers that reuse IDs across steps
  // (e.g. Google's `functions.tool:0` scheme) get globally unique tool call IDs.
  return {
    ...resolved,
    model: wrapLanguageModel({
      model: resolved.model,
      middleware: [uniqueToolCallIdMiddleware()],
    }),
  }
}

/**
 * Options for creating an agent from a preset.
 */
export interface CreateAgentOptions<TTools extends ToolSet> {
  /** Preset ID for model configuration */
  presetId: string
  /** System instructions for the agent */
  instructions: string
  /** Tools available to the agent */
  tools: TTools
  /** Stop condition for the agentic loop */
  stopWhen: StopCondition<TTools>
  /** Optional abort signal for cancellation - passed to generate() calls */
  signal?: AbortSignal
  /** Optional per-step hook to narrow the tools available on the next step. */
  prepareStep?: PrepareStepFunction<TTools>
}

/**
 * Extended agent interface that includes the abort signal.
 */
export interface AgentWithSignal<TTools extends ToolSet> {
  agent: ToolLoopAgent<never, TTools>
  signal?: AbortSignal
  generate: (params: { prompt: string }) => ReturnType<ToolLoopAgent<never, TTools>['generate']>
}

/**
 * Create a ToolLoopAgent from a preset configuration.
 *
 * This is the main entry point for creating agents that follow the
 * app's configuration patterns.
 *
 * @example
 * ```typescript
 * const agent = createAgentFromPreset({
 *   presetId: 'agentic',
 *   instructions: 'You are a lore management assistant...',
 *   tools: createLorebookTools(context),
 *   stopWhen: stopOnTerminalTool('finish_lore_management', 10),
 * });
 *
 * const result = await agent.generate({ prompt: '...' });
 * ```
 */
export function createAgentFromPreset<TTools extends ToolSet>(
  options: CreateAgentOptions<TTools>,
  serviceId: string,
): AgentWithSignal<TTools> {
  const { presetId, instructions, tools, stopWhen, signal, prepareStep } = options
  const { preset, providerType, model, providerOptions, reasoning } = resolveAgentConfig(
    presetId,
    serviceId,
  )

  log('createAgentFromPreset', {
    presetId,
    model: preset.model,
    providerType,
    toolCount: Object.keys(tools).length,
  })

  const agent = new ToolLoopAgent<never, TTools>({
    model,
    instructions,
    tools,
    stopWhen,
    prepareStep,
    temperature: !settings.advancedRequestSettings.manualMode ? preset.temperature : undefined,
    maxOutputTokens: !settings.advancedRequestSettings.manualMode ? preset.maxTokens : undefined,
    reasoning,
    providerOptions,
    // Cast: TS can't resolve ToolsContextParameter's conditional type for a
    // generic TTools, so no object literal is assignable without it.
  } as unknown as ToolLoopAgentSettings<never, TTools>)

  return {
    agent,
    signal,
    generate: (params: { prompt: string }) =>
      agent.generate({
        ...params,
        abortSignal: signal,
      }),
  }
}

/**
 * Options for creating a streaming assistant agent from a preset.
 */
export interface CreateAssistantOptions<TTools extends ToolSet> {
  /** Preset ID for model configuration */
  presetId: string
  /** System instructions for the agent */
  instructions: string
  /** Tools available to the agent */
  tools: TTools
  /** Stop condition for the agentic loop */
  stopWhen: StopCondition<TTools>
  /** Optional abort signal for cancellation - passed to generate() calls */
  signal?: AbortSignal
  /** Optional per-step hook to dynamically filter active tools */
  prepareStep?: PrepareStepFunction<TTools>
}

/**
 * Extended streaming assistant agent interface that includes the abort signal.
 */
export interface AssistantWithSignal<TTools extends ToolSet> {
  agent: ToolLoopAgent<never, TTools>
  signal?: AbortSignal
  stream: ToolLoopAgent<never, TTools>['stream']
}

export function createStreamingAgenticAssistant<TTools extends ToolSet>(
  options: CreateAssistantOptions<TTools>,
  serviceId: string,
): AssistantWithSignal<TTools> {
  const { presetId, instructions, tools, stopWhen, signal, prepareStep } = options
  const { preset, providerType, model, providerOptions, reasoning } = resolveAgentConfig(
    presetId,
    serviceId,
  )

  log('createStreamingAgenticAssistant', {
    presetId,
    model: preset.model,
    providerType,
    toolCount: Object.keys(tools).length,
  })
  const agent = new ToolLoopAgent<never, TTools>({
    model,
    instructions,
    tools,
    stopWhen,
    prepareStep,
    temperature: !settings.advancedRequestSettings.manualMode ? preset.temperature : undefined,
    maxOutputTokens: !settings.advancedRequestSettings.manualMode ? preset.maxTokens : undefined,
    reasoning,
    providerOptions,
    // Cast: TS can't resolve ToolsContextParameter's conditional type for a
    // generic TTools, so no object literal is assignable without it.
  } as unknown as ToolLoopAgentSettings<never, TTools>)

  return {
    agent,
    signal,
    stream: (params) =>
      agent.stream({
        ...params,
        abortSignal: signal,
      }),
  } as AssistantWithSignal<TTools>
}
/**
 * Agent result type helper.
 * Extracts the result type from a ToolLoopAgent.
 */
export type AgentResult<TTools extends ToolSet> = Awaited<
  ReturnType<ToolLoopAgent<never, TTools>['generate']>
>

/**
 * Extract tool call results from agent steps.
 *
 * @param steps - The steps from an agent result
 * @param toolName - The name of the tool to extract
 */
export function extractToolResults<T, TTools extends ToolSet = ToolSet>(
  steps: StepResult<TTools>[],
  toolName: string,
): T[] {
  const results: T[] = []

  for (const step of steps) {
    if (!step.toolResults) continue

    for (const toolResult of step.toolResults) {
      // AI SDK uses 'output' property for tool results (not 'result')
      if (toolResult.toolName === toolName && 'output' in toolResult) {
        results.push(toolResult.output as T)
      }
    }
  }

  return results
}

/**
 * Find the result from a terminal tool call.
 * Returns the result from the first call of the specified tool.
 *
 * @param steps - The steps from an agent result
 * @param toolName - The name of the terminal tool
 */
export function extractTerminalToolResult<T, TTools extends ToolSet = ToolSet>(
  steps: StepResult<TTools>[],
  toolName: string,
): T | undefined {
  for (const step of steps) {
    if (!step.toolResults) continue

    for (const toolResult of step.toolResults) {
      if (toolResult.toolName === toolName) {
        // AI SDK uses 'output' property for tool results (not 'result')
        if ('output' in toolResult) {
          return toolResult.output as T
        }
      }
    }
  }

  return undefined
}
