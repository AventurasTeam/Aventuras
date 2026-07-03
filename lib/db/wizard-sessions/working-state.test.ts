import { describe, expect, it } from 'vitest'

import { emptyWorkingState, wizardWorkingStateSchema } from './working-state'

describe('wizardWorkingStateSchema', () => {
  it('emptyWorkingState parses and starts on step 1 with creative/third defaults', () => {
    const s = emptyWorkingState()
    expect(() => wizardWorkingStateSchema.parse(s)).not.toThrow()
    expect(s.step).toBe(1)
    expect(s.definition.mode).toBe('creative')
    expect(s.definition.narration).toBe('third')
    expect(s.leadName).toBe('')
    expect(s.opening.content).toBe('')
  })
  it('round-trips a fully-populated state', () => {
    const s = emptyWorkingState()
    s.definition.title = 'T'
    s.opening.content = 'Once.'
    s.opening.model = 'gpt-x'
    expect(() => wizardWorkingStateSchema.parse(s)).not.toThrow()
  })
})
