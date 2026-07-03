import { beforeEach, describe, expect, it } from 'vitest'

import { wizardStore } from './wizard-store'

describe('wizardStore', () => {
  beforeEach(() => wizardStore.reset())

  it('starts empty on step 1', () => {
    expect(wizardStore.getState().state.step).toBe(1)
  })

  it('patchDefinition merges into the working-state', () => {
    wizardStore.patchDefinition({ mode: 'adventure', narration: 'first' })
    expect(wizardStore.getState().state.definition.mode).toBe('adventure')
    expect(wizardStore.getState().state.definition.narration).toBe('first')
  })

  it('patchOpening merges into the opening', () => {
    wizardStore.patchOpening({ content: 'Once.' })
    expect(wizardStore.getState().state.opening.content).toBe('Once.')
  })

  it('setLeadName updates leadName', () => {
    wizardStore.setLeadName('Aria')
    expect(wizardStore.getState().state.leadName).toBe('Aria')
  })

  it('setStep updates the step', () => {
    wizardStore.setStep(2)
    expect(wizardStore.getState().state.step).toBe(2)
  })

  it('hydrate replaces the working-state (draft resume)', () => {
    const draft = { ...wizardStore.getState().state, leadName: 'Aria', step: 5 }
    wizardStore.hydrate(draft)
    expect(wizardStore.getState().state.leadName).toBe('Aria')
    expect(wizardStore.getState().state.step).toBe(5)
  })

  it('reset returns to empty', () => {
    wizardStore.setLeadName('X')
    wizardStore.setStep(2)
    wizardStore.reset()
    expect(wizardStore.getState().state.leadName).toBe('')
    expect(wizardStore.getState().state.step).toBe(1)
  })
})
