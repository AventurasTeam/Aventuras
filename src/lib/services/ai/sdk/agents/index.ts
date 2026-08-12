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
  stopOnCompletedTerminalTool,
  stopWhenDone,
  finishOnlyOnLastStep,
} from './stopConditions'
