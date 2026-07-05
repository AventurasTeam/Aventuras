import { beforeEach, describe, expect, it } from 'vitest'

import type { ResolveModelConfig } from '@/lib/ai'
import { wizardStore } from '@/lib/stores'

import {
  resolveWizardAssistModelId,
  runDescriptionAssist,
  runOpeningAssist,
  runTitleAssist,
  type WizardAssistDeps,
} from './wizard-assist'

const LEAD_ID = 'char_11111111-1111-1111-1111-111111111111'
const MODEL_ID = 'test-model'

const CONFIGURED: ResolveModelConfig = {
  providers: [
    { id: 'p', type: 'openai-compatible', displayName: 'P', apiKey: 'k', favoriteModelIds: [] },
  ],
  profiles: [
    { id: 'prof', kind: 'agent', name: 'Wizard', modelRef: { providerId: 'p', modelId: MODEL_ID } },
  ],
  assignments: { 'wizard-assist': 'prof' },
  defaultProviderId: 'p',
}
const UNCONFIGURED: ResolveModelConfig = {
  providers: [],
  profiles: [],
  assignments: {},
  defaultProviderId: null,
}

const signal = new AbortController().signal

// A generate seam returning a fixed raw model reply — the cast sidesteps the
// generic signature of the real generateStructured.
function okGenerate(value: unknown): WizardAssistDeps['generate'] {
  return (async () => ({ status: 'ok', value })) as WizardAssistDeps['generate']
}
function failGenerate(detail: string): WizardAssistDeps['generate'] {
  return (async () => ({ status: 'failed', detail })) as WizardAssistDeps['generate']
}
function deps(value: unknown): WizardAssistDeps {
  return { resolveConfig: () => CONFIGURED, generate: okGenerate(value) }
}

describe('runOpeningAssist', () => {
  beforeEach(() => wizardStore.reset())

  it('round-trips a returned lead placeholder back to the real lead id', async () => {
    wizardStore.patchDefinition({ mode: 'adventure', narration: 'first' })
    wizardStore.setLeadName('Aria')
    wizardStore.setLeadEntityId(LEAD_ID)
    // leadEntityId is the only id in state, so substituteIds allocates it 'c1'.
    const res = await runOpeningAssist(
      '',
      signal,
      deps({
        prose: 'Aria stood ready.',
        sceneEntities: ['c1'],
        currentLocationId: null,
        worldTime: 0,
      }),
    )
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.value.content).toBe('Aria stood ready.')
    expect(res.value.sceneEntities).toEqual([LEAD_ID])
    expect(res.value.model).toBe(MODEL_ID)
  })

  it('mints a lead id when the path needs one and none exists yet', async () => {
    wizardStore.patchDefinition({ mode: 'adventure', narration: 'first' })
    wizardStore.setLeadName('Kade')
    expect(wizardStore.getWizard().state.leadEntityId).toBeNull()

    await runOpeningAssist(
      '',
      signal,
      deps({ prose: 'x', sceneEntities: [], currentLocationId: null, worldTime: 0 }),
    )
    expect(wizardStore.getWizard().state.leadEntityId).not.toBeNull()
  })

  it('falls back to user-written (drops metadata) when a placeholder cannot resolve', async () => {
    // Lead-less path → empty idMap → the returned placeholder is unresolvable.
    wizardStore.patchDefinition({ mode: 'creative', narration: 'third' })
    const res = await runOpeningAssist(
      '',
      signal,
      deps({
        prose: 'The map unrolled.',
        sceneEntities: ['c1'],
        currentLocationId: null,
        worldTime: 0,
      }),
    )
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.value.content).toBe('The map unrolled.')
    expect(res.value.sceneEntities).toEqual([])
    expect(res.value.model).toBeNull()
  })

  it('propagates a non-ok result unchanged', async () => {
    const res = await runOpeningAssist('', signal, {
      resolveConfig: () => CONFIGURED,
      generate: failGenerate('boom'),
    })
    expect(res).toEqual({ status: 'failed', detail: 'boom' })
  })
})

describe('runTitleAssist / runDescriptionAssist', () => {
  beforeEach(() => wizardStore.reset())

  it('returns title chips passthrough', async () => {
    const res = await runTitleAssist('', signal, deps({ titles: ['A', 'B'] }))
    expect(res.status === 'ok' && res.value.titles).toEqual(['A', 'B'])
  })

  it('returns description passthrough', async () => {
    const res = await runDescriptionAssist('', signal, deps({ description: 'A tale.' }))
    expect(res.status === 'ok' && res.value.description).toBe('A tale.')
  })
})

describe('resolveWizardAssistModelId', () => {
  it('returns the configured model id', () => {
    expect(resolveWizardAssistModelId({ resolveConfig: () => CONFIGURED })).toBe(MODEL_ID)
  })
  it('returns null when unconfigured', () => {
    expect(resolveWizardAssistModelId({ resolveConfig: () => UNCONFIGURED })).toBeNull()
  })
})
