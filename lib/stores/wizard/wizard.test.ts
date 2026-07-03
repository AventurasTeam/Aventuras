import { beforeEach, describe, expect, it } from 'vitest'

import { emptyWorkingState } from '@/lib/db'

import { wizardStore } from './wizard'

describe('wizardStore', () => {
  beforeEach(() => wizardStore.reset())

  it('starts empty on step 1', () => {
    expect(wizardStore.getWizard().state.step).toBe(1)
  })

  it('patchDefinition merges into the working-state', () => {
    wizardStore.patchDefinition({ mode: 'adventure', narration: 'first' })
    expect(wizardStore.getWizard().state.definition.mode).toBe('adventure')
    expect(wizardStore.getWizard().state.definition.narration).toBe('first')
    expect(wizardStore.getWizard().state.definition.title).toBe('')
  })

  it('patchOpening merges into the opening', () => {
    wizardStore.patchOpening({ content: 'Once.' })
    expect(wizardStore.getWizard().state.opening.content).toBe('Once.')
  })

  it('setLeadName updates leadName', () => {
    wizardStore.setLeadName('Aria')
    expect(wizardStore.getWizard().state.leadName).toBe('Aria')
  })

  it('setStep updates the step', () => {
    wizardStore.setStep(2)
    expect(wizardStore.getWizard().state.step).toBe(2)
  })

  it('hydrate replaces the working-state (draft resume)', () => {
    wizardStore.setStep(3)
    wizardStore.patchDefinition({ mode: 'adventure' })

    const draft = { ...emptyWorkingState(), leadName: 'Aria', step: 5 }
    wizardStore.hydrate(draft)

    expect(wizardStore.getWizard().state.leadName).toBe('Aria')
    expect(wizardStore.getWizard().state.step).toBe(5)
    expect(wizardStore.getWizard().state.definition.mode).toBe('creative')
  })

  it('reset returns to empty', () => {
    wizardStore.setLeadName('X')
    wizardStore.setStep(2)
    const before = wizardStore.getWizard().state.definition
    wizardStore.reset()
    const after = wizardStore.getWizard().state.definition
    expect(wizardStore.getWizard().state.leadName).toBe('')
    expect(wizardStore.getWizard().state.step).toBe(1)
    expect(before).not.toBe(after)
  })
})
