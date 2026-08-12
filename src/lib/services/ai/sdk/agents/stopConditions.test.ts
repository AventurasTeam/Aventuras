import { describe, it, expect } from 'vitest'
import { stopOnCompletedTerminalTool, stopOnTerminalTool } from './stopConditions'

/** The two fields either condition reads, in the shape a step result has them. */
const step = (calls: string[], results: { toolName: string; output: unknown }[] = []) =>
  ({
    toolCalls: calls.map((toolName) => ({ toolName })),
    toolResults: results,
  }) as never

const run = (condition: ReturnType<typeof stopOnTerminalTool>, steps: unknown[]) =>
  condition({ steps } as never)

describe('stopOnCompletedTerminalTool', () => {
  it('keeps going when the terminal tool refused to complete', () => {
    const condition = stopOnCompletedTerminalTool('finish', 10)
    const steps = [step(['finish'], [{ toolName: 'finish', output: { completed: false } }])]

    expect(run(condition, steps)).toBe(false)
    // The condition it replaces reads the call, so it would have ended the run here.
    expect(run(stopOnTerminalTool('finish', 10), steps)).toBe(true)
  })

  it('stops once the terminal tool completes', () => {
    const condition = stopOnCompletedTerminalTool('finish', 10)
    expect(
      run(condition, [step(['finish'], [{ toolName: 'finish', output: { completed: true } }])]),
    ).toBe(true)
  })

  it('stops at the step limit, so a tool that never completes cannot hang the run', () => {
    const condition = stopOnCompletedTerminalTool('finish', 2)
    const refusal = step(['finish'], [{ toolName: 'finish', output: { completed: false } }])

    expect(run(condition, [refusal, refusal])).toBe(true)
  })

  it('ignores another tool completing', () => {
    const condition = stopOnCompletedTerminalTool('finish', 10)
    expect(
      run(condition, [step(['other'], [{ toolName: 'other', output: { completed: true } }])]),
    ).toBe(false)
  })
})
