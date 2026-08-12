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
 * On the last step, leave the terminal tool as the only callable one and require it.
 *
 * A run that reaches `maxSteps` without calling it produces nothing the agent wrote: its
 * findings live in its own message history and nowhere else, and no reconstruction from
 * the outside comes close to what it would write with all of that still in context. So
 * rather than salvage afterwards, spend the step that was going to happen anyway on the
 * summary. It costs no extra call.
 *
 * Does not cover a run that *dies* — a context overflow has nobody left to ask.
 */
export function finishOnlyOnLastStep(toolName: string, maxSteps: number) {
  const lastStep = Math.max(0, maxSteps - 1)
  return ({ stepNumber }: { stepNumber: number }) =>
    stepNumber >= lastStep
      ? {
          activeTools: [toolName],
          toolChoice: { type: 'tool' as const, toolName },
        }
      : {}
}
