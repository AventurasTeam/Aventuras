/**
 * Custom Stop Conditions
 *
 * Stop condition factories for agentic tool loops.
 * These are used with ToolLoopAgent's stopWhen parameter.
 */

import type { StopCondition, ToolSet } from 'ai'

/**
 * Stop when a specific terminal tool is called.
 * Also enforces a maximum step count as a safety limit.
 *
 * @param toolName - The name of the terminal tool
 * @param maxSteps - Maximum steps before forced stop (default: 10)
 */
export function stopOnTerminalTool<TTools extends ToolSet = ToolSet>(
  toolName: string,
  maxSteps: number = 10,
): StopCondition<TTools> {
  return ({ steps }) => {
    // Check step limit first
    if (steps.length >= maxSteps) {
      return true
    }

    // Check if the terminal tool was called in the most recent step
    const lastStep = steps[steps.length - 1]
    if (!lastStep) {
      return false
    }

    // Check for tool calls in the last step
    const toolCalls = lastStep.toolCalls
    if (!toolCalls || toolCalls.length === 0) {
      return false
    }

    // Stop if the terminal tool was called
    return toolCalls.some((tc) => tc.toolName === toolName)
  }
}

/**
 * Stop when a terminal tool returns `completed: true`, rather than when it is called.
 *
 * A terminal tool that can refuse — "you have not dealt with these duplicates yet" — needs
 * the loop to survive the call it refused, and `stopOnTerminalTool` reads the call, not the
 * answer. The step limit still applies, so a tool that never accepts cannot hang the run.
 *
 * @param toolName - The name of the terminal tool
 * @param maxSteps - Maximum steps before forced stop (default: 10)
 */
export function stopOnCompletedTerminalTool<TTools extends ToolSet = ToolSet>(
  toolName: string,
  maxSteps: number = 10,
): StopCondition<TTools> {
  return ({ steps }) => {
    if (steps.length >= maxSteps) {
      return true
    }

    const lastStep = steps[steps.length - 1]
    if (!lastStep?.toolResults) {
      return false
    }

    return lastStep.toolResults.some((result) => {
      if (result.toolName !== toolName) return false
      const output = 'output' in result ? (result.output as { completed?: boolean }) : undefined
      return output?.completed === true
    })
  }
}

/**
 * Stop when any of the specified tools is called.
 * Useful for agents that can terminate via multiple paths.
 *
 * @param toolNames - Array of tool names that trigger stop
 * @param maxSteps - Maximum steps before forced stop (default: 10)
 */
export function stopOnAnyToolCall<TTools extends ToolSet = ToolSet>(
  toolNames: string[],
  maxSteps: number = 10,
): StopCondition<TTools> {
  const toolSet = new Set(toolNames)

  return ({ steps }) => {
    // Check step limit first
    if (steps.length >= maxSteps) {
      return true
    }

    // Check if any terminal tool was called in the most recent step
    const lastStep = steps[steps.length - 1]
    if (!lastStep) {
      return false
    }

    const toolCalls = lastStep.toolCalls
    if (!toolCalls || toolCalls.length === 0) {
      return false
    }

    return toolCalls.some((tc) => toolSet.has(tc.toolName))
  }
}

/**
 * Combine multiple stop conditions with OR logic.
 * Stops when any condition is met.
 *
 * @param conditions - Array of stop conditions
 */
export function stopOnAny<TTools extends ToolSet = ToolSet>(
  ...conditions: StopCondition<TTools>[]
): StopCondition<TTools> {
  return (context) => conditions.some((condition) => condition(context))
}

/**
 * Stop when the model stops making tool calls (i.e., it's done working).
 * Continues as long as the model keeps calling tools.
 * Has a safety limit to prevent infinite loops.
 *
 * @param maxSteps - Maximum steps before forced stop (default: 50)
 */
export function stopWhenDone<TTools extends ToolSet = ToolSet>(
  maxSteps: number = 50,
): StopCondition<TTools> {
  return ({ steps }) => {
    // Check step limit first (safety)
    if (steps.length >= maxSteps) {
      return true
    }

    // If no steps yet, continue
    const lastStep = steps[steps.length - 1]
    if (!lastStep) {
      return false
    }

    // Stop if the last step had no tool calls (model is done)
    const toolCalls = lastStep.toolCalls
    return !toolCalls || toolCalls.length === 0
  }
}

/**
 * Create a cost-based stop condition.
 * Stops when estimated cost exceeds the budget.
 *
 * @param maxCostUsd - Maximum cost in USD
 * @param inputCostPer1k - Cost per 1000 input tokens (default: $0.01)
 * @param outputCostPer1k - Cost per 1000 output tokens (default: $0.03)
 */
export function stopOnCostExceeded<TTools extends ToolSet = ToolSet>(
  maxCostUsd: number,
  inputCostPer1k: number = 0.01,
  outputCostPer1k: number = 0.03,
): StopCondition<TTools> {
  return ({ steps }) => {
    const totalUsage = steps.reduce(
      (acc, step) => ({
        inputTokens: acc.inputTokens + (step.usage?.inputTokens ?? 0),
        outputTokens: acc.outputTokens + (step.usage?.outputTokens ?? 0),
      }),
      { inputTokens: 0, outputTokens: 0 },
    )

    const costEstimate =
      (totalUsage.inputTokens * inputCostPer1k + totalUsage.outputTokens * outputCostPer1k) / 1000

    return costEstimate > maxCostUsd
  }
}
