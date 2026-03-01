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
} from 'ai'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import { settings } from '$lib/stores/settings.svelte'
import { createProviderFromProfile } from '../providers'
import { buildProviderOptions } from '../generate'
import { uniqueToolCallIdMiddleware } from '../middleware'
import type { GenerationPreset, APIProfile, ProviderType } from '$lib/types'
import { createLogger } from '../../core/config'

const log = createLogger('AgentFactory')

/**
 * Resolved configuration for creating an agent.
 */
export interface ResolvedAgentConfig {
  preset: GenerationPreset
  profile: APIProfile
  providerType: ProviderType
  model: LanguageModelV3
  providerOptions: ProviderOptions | undefined
}

/**
 * Resolve preset → profile → model for agent creation.
 * This follows the same pattern as resolveConfig in generate.ts
 *
 * @param presetId - The preset ID (e.g., 'agentic', 'loreManagement')
 */
export function resolveAgentConfig(
  presetId: string,
  serviceId: string,
  debugId?: string,
): ResolvedAgentConfig {
  const preset = settings.getPresetConfig(presetId)
  const profileId = preset.profileId ?? settings.apiSettings.mainNarrativeProfileId
  const profile = settings.getProfile(profileId)

  if (!profile) {
    throw new Error(`Profile not found: ${profileId}`)
  }

  const provider = createProviderFromProfile(profile, serviceId, debugId)
  // Call provider directly - all providers support provider(modelId) syntax
  const baseModel = provider(preset.model) as LanguageModelV3
  // Wrap with uniqueToolCallIdMiddleware so providers that reuse IDs across steps
  // (e.g. Google's `functions.tool:0` scheme) get globally unique tool call IDs.
  const model = wrapLanguageModel({ model: baseModel, middleware: [uniqueToolCallIdMiddleware()] })
  const providerOptions = buildProviderOptions(preset, profile.providerType)

  return { preset, profile, providerType: profile.providerType, model, providerOptions }
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
  const { presetId, instructions, tools, stopWhen, signal } = options
  const { preset, providerType, model, providerOptions } = resolveAgentConfig(presetId, serviceId)

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
    temperature: preset.temperature,
    maxOutputTokens: preset.maxTokens,
    providerOptions,
  })

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
