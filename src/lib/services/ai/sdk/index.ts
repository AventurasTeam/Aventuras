/**
 * Vercel AI SDK Integration
 *
 * Central module for all AI SDK functionality.
 *
 * Usage:
 * ```typescript
 * import { generateStructured, suggestionsResultSchema } from '$lib/services/ai/sdk';
 *
 * const result = await generateStructured({
 *   presetId: 'suggestions',
 *   schema: suggestionsResultSchema,
 *   system: systemPrompt,
 *   prompt: userPrompt,
 * });
 * ```
 */

// Generate functions
export {
  generateStructured,
  generatePlainText,
  streamPlainText,
  streamStructured,
  buildProviderOptions,
} from './generate'

// Provider registry
export { createProviderFromProfile, PROVIDERS } from './providers'

// Agent factory and stop conditions
export {
  createAgentFromPreset,
  resolveAgentConfig,
  extractToolResults,
  extractTerminalToolResult,
  stopOnTerminalTool,
  stopOnAnyToolCall,
  stopOnAny,
  stopOnCostExceeded,
  stopWhenDone,
} from './agents'

// Tool factories
export {
  createLoreManagementTools,
  createInteractiveVaultLorebookTools,
  createFandomTools,
  createRetrievalTools,
} from './tools'

// Types
export type { ProviderType, APIProfile } from '$lib/types'
export type { ProviderConfig, ServiceModelDefaults } from './providers'
export type { ResolvedAgentConfig, CreateAgentOptions, AgentResult } from './agents'
export type {
  LorebookEntryToolContext,
  StoryToolContext,
  VaultLorebookToolContext,
  ChapterInfo,
  VaultLorebookPendingChangeSchema,
  LorebookEntryTools,
  StoryTools,
  VaultLorebookTools,
  LoreManagementTools,
  InteractiveVaultLorebookTools,
  FandomToolContext,
  FandomTools,
  RetrievalToolContext,
  RetrievalTools,
} from './tools'

// Schemas
export * from './schemas'
