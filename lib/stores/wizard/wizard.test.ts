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

  it('setEffectiveDim stores the dim and marks it touched (incl. Native/null)', () => {
    wizardStore.setEffectiveDim(1024)
    expect(wizardStore.getWizard().state.effectiveDim).toBe(1024)
    expect(wizardStore.getWizard().state.effectiveDimTouched).toBe(true)

    wizardStore.setEffectiveDim(null)
    expect(wizardStore.getWizard().state.effectiveDim).toBeNull()
    // An explicit Native pick still counts as touched, so the platform
    // pre-selection won't re-suggest it on a later disclosure remount.
    expect(wizardStore.getWizard().state.effectiveDimTouched).toBe(true)
  })

  it('reset clears the effectiveDim touched flag', () => {
    wizardStore.setEffectiveDim(512)
    wizardStore.reset()
    expect(wizardStore.getWizard().state.effectiveDimTouched).toBe(false)
    expect(wizardStore.getWizard().state.effectiveDim).toBeNull()
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

  it('a valid dim clears the invalid-draft flag', () => {
    wizardStore.setCustomDimInvalid(true)
    expect(wizardStore.getWizard().customDimInvalid).toBe(true)
    // Clearing lives inside setEffectiveDim, so every path that commits a dim —
    // ladder radio, Native, a corrected custom entry — releases the gate without
    // each caller having to remember to.
    wizardStore.setEffectiveDim(512)
    expect(wizardStore.getWizard().customDimInvalid).toBe(false)

    wizardStore.setCustomDimInvalid(true)
    wizardStore.setEffectiveDim(null)
    expect(wizardStore.getWizard().customDimInvalid).toBe(false)
  })

  it('the invalid-draft flag is ephemeral: reset and hydrate drop it', () => {
    wizardStore.setCustomDimInvalid(true)
    wizardStore.reset()
    expect(wizardStore.getWizard().customDimInvalid).toBe(false)

    wizardStore.setCustomDimInvalid(true)
    wizardStore.hydrate(wizardStore.getWizard().state)
    // A resumed draft persists the dim, never an unparseable keystroke.
    expect(wizardStore.getWizard().customDimInvalid).toBe(false)
  })
})

describe('lore mutators', () => {
  beforeEach(() => wizardStore.reset())

  it('addLore appends a row with a minted lore id and empty fields', () => {
    wizardStore.addLore()
    const [row] = wizardStore.getWizard().state.lore
    expect(row.id).toMatch(/^lore_/)
    expect(row.title).toBe('')
    expect(row.body).toBe('')
    expect(row.injectionMode).toBe('auto')
  })

  it('patchLore updates only the addressed row', () => {
    wizardStore.addLore()
    wizardStore.addLore()
    const [first, second] = wizardStore.getWizard().state.lore
    expect(first.id).not.toBe(second.id)
    wizardStore.patchLore(second.id, { title: 'Second' })
    const after = wizardStore.getWizard().state.lore
    expect(after[0]).toBe(first)
    expect(after[1].title).toBe('Second')
  })

  it('removeLore drops the addressed row and keeps order', () => {
    wizardStore.addLore()
    wizardStore.addLore()
    wizardStore.addLore()
    const ids = wizardStore.getWizard().state.lore.map((r) => r.id)
    wizardStore.removeLore(ids[1])
    expect(wizardStore.getWizard().state.lore.map((r) => r.id)).toEqual([ids[0], ids[2]])
  })

  it('importLore appends a batch in one write', () => {
    wizardStore.addLore()
    wizardStore.importLore([
      { title: 'A', body: 'a' },
      { title: 'B', body: 'b' },
    ])
    const rows = wizardStore.getWizard().state.lore
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.title)).toEqual(['', 'A', 'B'])
    expect(new Set(rows.map((r) => r.id)).size, 'imported ids are distinct').toBe(3)
  })
})
