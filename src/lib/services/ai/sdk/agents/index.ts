/**
 * Agent Module Index
 *
 * Exports agent factory and stop conditions.
 */

export {
  createAgentFromPreset,
  extractToolResults,
  extractTerminalToolResult,
  type ResolvedAgentConfig,
  type CreateAgentOptions,
  type AgentResult,
} from './factory'

export {
  stopOnTerminalTool,
  stopOnAnyToolCall,
  stopOnAny,
  stopOnCostExceeded,
  stopWhenDone,
} from './stopConditions'
