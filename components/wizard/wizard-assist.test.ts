import { beforeEach, describe, expect, it } from 'vitest'

import type { ResolveModelConfig } from '@/lib/ai'
import { wizardStore } from '@/lib/stores'

import {
  refineDescriptionAssist,
  refineGenreAssist,
  refineOpeningAssist,
  refineSettingAssist,
  refineToneAssist,
  resolveWizardAssistModelId,
  runCastAssist,
  runDescriptionAssist,
  runGenreAssist,
  runLoreAssist,
  runOpeningAssist,
  runSettingAssist,
  runTitleAssist,
  runToneAssist,
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

describe('runLoreAssist', () => {
  beforeEach(() => wizardStore.reset())

  it('renders the lore template and returns the parsed batch', async () => {
    let capturedPrompt = ''
    const lore = [{ title: 'The Old Empire', body: 'Fell.', category: 'history' }]
    const generate: WizardAssistDeps['generate'] = (async (_target, prompt) => {
      capturedPrompt = prompt as string
      return { status: 'ok', value: { lore } }
    }) as WizardAssistDeps['generate']

    const res = await runLoreAssist('', signal, { resolveConfig: () => CONFIGURED, generate })
    expect(res).toEqual({ status: 'ok', value: { lore } })
    expect(capturedPrompt).toContain("Suggest five reference entries for this story's world")
    // Nothing on screen yet, so the exclusion block must not render at all.
    expect(capturedPrompt).not.toContain('Already written')
  })

  it('excludes the names already on screen so a further page is not a re-roll', async () => {
    let capturedPrompt = ''
    const generate: WizardAssistDeps['generate'] = (async (_target, prompt) => {
      capturedPrompt = prompt as string
      return { status: 'ok', value: { lore: [] } }
    }) as WizardAssistDeps['generate']

    await runLoreAssist('', signal, { resolveConfig: () => CONFIGURED, generate }, [
      'The Salt Wells',
      'The Hollow King',
    ])
    expect(capturedPrompt).toContain('Already written (do not repeat these):')
    expect(capturedPrompt).toContain('- The Salt Wells')
    expect(capturedPrompt).toContain('- The Hollow King')
  })
})

describe('runCastAssist', () => {
  beforeEach(() => wizardStore.reset())

  it('renders the cast template and returns the parsed batch', async () => {
    let capturedPrompt = ''
    const entities = [{ kind: 'item', name: 'Coin', description: 'Old.' }]
    const generate: WizardAssistDeps['generate'] = (async (_target, prompt) => {
      capturedPrompt = prompt as string
      return { status: 'ok', value: { entities } }
    }) as WizardAssistDeps['generate']

    const res = await runCastAssist('', signal, { resolveConfig: () => CONFIGURED, generate })
    expect(res).toEqual({ status: 'ok', value: { entities } })
    expect(capturedPrompt).toContain('Suggest five cast entries')
    // Nothing on screen yet, so the exclusion block must not render at all.
    expect(capturedPrompt).not.toContain('Already in the cast')
  })

  it('excludes the names already on screen so a further page is not a re-roll', async () => {
    let capturedPrompt = ''
    const generate: WizardAssistDeps['generate'] = (async (_target, prompt) => {
      capturedPrompt = prompt as string
      return { status: 'ok', value: { entities: [] } }
    }) as WizardAssistDeps['generate']

    const res = await runCastAssist(
      'more items',
      signal,
      { resolveConfig: () => CONFIGURED, generate },
      ['Old Jorin'],
    )
    expect(res.status).toBe('ok')
    expect(capturedPrompt).toContain('Already in the cast (do not repeat these):')
    expect(capturedPrompt).toContain('- Old Jorin')
  })
})

describe('refineOpeningAssist', () => {
  beforeEach(() => wizardStore.reset())

  it('passes a prompt containing both the current prose and the instruction', async () => {
    wizardStore.patchDefinition({ mode: 'creative', narration: 'third' })
    let capturedPrompt = ''
    const generate: WizardAssistDeps['generate'] = (async (_target, prompt) => {
      capturedPrompt = prompt as string
      return {
        status: 'ok',
        value: { prose: 'Revised.', sceneEntities: [], currentLocationId: null, worldTime: 0 },
      }
    }) as WizardAssistDeps['generate']

    const res = await refineOpeningAssist(
      { content: 'The map unrolled.', sceneEntities: [], currentLocationId: null, model: null },
      'make it darker',
      signal,
      { resolveConfig: () => CONFIGURED, generate },
    )
    expect(res.status === 'ok' && res.value.content).toBe('Revised.')
    expect(capturedPrompt).toContain('The map unrolled.')
    expect(capturedPrompt).toContain('make it darker')
  })
})

describe('refineDescriptionAssist', () => {
  beforeEach(() => wizardStore.reset())

  it('passes a prompt containing both the current description and the instruction', async () => {
    let capturedPrompt = ''
    const generate: WizardAssistDeps['generate'] = (async (_target, prompt) => {
      capturedPrompt = prompt as string
      return { status: 'ok', value: { description: 'A darker tale.' } }
    }) as WizardAssistDeps['generate']

    const res = await refineDescriptionAssist(
      { description: 'A tale.' },
      'make it darker',
      signal,
      { resolveConfig: () => CONFIGURED, generate },
    )
    expect(res.status === 'ok' && res.value.description).toBe('A darker tale.')
    expect(capturedPrompt).toContain('A tale.')
    expect(capturedPrompt).toContain('make it darker')
  })
})

describe('runGenreAssist', () => {
  beforeEach(() => wizardStore.reset())

  it('renders the genre template and returns the parsed label + body', async () => {
    let capturedPrompt = ''
    const value = { label: 'Hard sci-fi', promptBody: 'Rigorous futures.' }
    const generate: WizardAssistDeps['generate'] = (async (_target, prompt) => {
      capturedPrompt = prompt as string
      return { status: 'ok', value }
    }) as WizardAssistDeps['generate']

    const res = await runGenreAssist('', signal, { resolveConfig: () => CONFIGURED, generate })
    expect(res).toEqual({ status: 'ok', value })
    expect(capturedPrompt).toContain('Suggest a genre for this story')
  })
})

describe('runToneAssist', () => {
  beforeEach(() => wizardStore.reset())

  it('renders the tone template and returns the parsed label + body', async () => {
    let capturedPrompt = ''
    const value = { label: 'Grim and unsparing', promptBody: 'Consequences land and stay.' }
    const generate: WizardAssistDeps['generate'] = (async (_target, prompt) => {
      capturedPrompt = prompt as string
      return { status: 'ok', value }
    }) as WizardAssistDeps['generate']

    const res = await runToneAssist('', signal, { resolveConfig: () => CONFIGURED, generate })
    expect(res).toEqual({ status: 'ok', value })
    expect(capturedPrompt).toContain('Suggest a tone for this story')
  })
})

describe('runSettingAssist', () => {
  beforeEach(() => wizardStore.reset())

  it('renders the setting template and returns the parsed setting', async () => {
    let capturedPrompt = ''
    const value = { setting: 'A drowned coast, centuries after the flood.' }
    const generate: WizardAssistDeps['generate'] = (async (_target, prompt) => {
      capturedPrompt = prompt as string
      return { status: 'ok', value }
    }) as WizardAssistDeps['generate']

    const res = await runSettingAssist('', signal, { resolveConfig: () => CONFIGURED, generate })
    expect(res).toEqual({ status: 'ok', value })
    expect(capturedPrompt).toContain('Suggest a setting for this story')
  })
})

describe('refineGenreAssist', () => {
  beforeEach(() => wizardStore.reset())

  it('passes a prompt containing the current label, body, and the instruction', async () => {
    let capturedPrompt = ''
    const generate: WizardAssistDeps['generate'] = (async (_target, prompt) => {
      capturedPrompt = prompt as string
      return { status: 'ok', value: { label: 'Grimdark sci-fi', promptBody: 'Even darker.' } }
    }) as WizardAssistDeps['generate']

    const res = await refineGenreAssist(
      { label: 'Hard sci-fi', promptBody: 'Rigorous futures.' },
      'make it darker',
      signal,
      { resolveConfig: () => CONFIGURED, generate },
    )
    expect(res.status === 'ok' && res.value.label).toBe('Grimdark sci-fi')
    expect(capturedPrompt).toContain('Hard sci-fi')
    expect(capturedPrompt).toContain('Rigorous futures.')
    expect(capturedPrompt).toContain('make it darker')
    // GenreAssistValue and ToneAssistValue are the same shape, so the seams are
    // interchangeable without a type error. The refine template's own directive
    // and its contract macro are all that catch a mis-wired one.
    expect(capturedPrompt).toContain('Revise the genre below')
    expect(capturedPrompt).toContain('naming the genre')
    expect(capturedPrompt).not.toContain('Revise the tone below')
    // A refine leads with the revise directive. The generate directive that used
    // to carry it — with the revision demoted into `guidance` — is gone.
    expect(capturedPrompt).not.toContain('Suggest a genre for this story')
  })
})

describe('refineToneAssist', () => {
  beforeEach(() => wizardStore.reset())

  it('passes a prompt containing the current label, body, and the instruction', async () => {
    let capturedPrompt = ''
    const generate: WizardAssistDeps['generate'] = (async (_target, prompt) => {
      capturedPrompt = prompt as string
      return { status: 'ok', value: { label: 'Bleaker', promptBody: 'No mercy at all.' } }
    }) as WizardAssistDeps['generate']

    const res = await refineToneAssist(
      { label: 'Grim and unsparing', promptBody: 'Consequences land and stay.' },
      'make it darker',
      signal,
      { resolveConfig: () => CONFIGURED, generate },
    )
    expect(res.status === 'ok' && res.value.label).toBe('Bleaker')
    expect(capturedPrompt).toContain('Grim and unsparing')
    expect(capturedPrompt).toContain('Consequences land and stay.')
    expect(capturedPrompt).toContain('make it darker')
    // See refineGenreAssist: the value types are identical, so these lines are
    // the only thing standing between a mis-wired seam and a green suite.
    expect(capturedPrompt).toContain('Revise the tone below')
    expect(capturedPrompt).toContain('naming the tone')
    expect(capturedPrompt).not.toContain('Revise the genre below')
    expect(capturedPrompt).not.toContain('Suggest a tone for this story')
  })
})

describe('refineSettingAssist', () => {
  beforeEach(() => wizardStore.reset())

  it('passes a prompt containing the current setting and the instruction', async () => {
    let capturedPrompt = ''
    const generate: WizardAssistDeps['generate'] = (async (_target, prompt) => {
      capturedPrompt = prompt as string
      return { status: 'ok', value: { setting: 'A drowned coast, now storm-wracked.' } }
    }) as WizardAssistDeps['generate']

    const res = await refineSettingAssist(
      { setting: 'A drowned coast, centuries after the flood.' },
      'make it darker',
      signal,
      { resolveConfig: () => CONFIGURED, generate },
    )
    expect(res.status === 'ok' && res.value.setting).toBe('A drowned coast, now storm-wracked.')
    expect(capturedPrompt).toContain('A drowned coast, centuries after the flood.')
    expect(capturedPrompt).toContain('make it darker')
    expect(capturedPrompt).toContain('Revise the setting below')
    expect(capturedPrompt).not.toContain('Suggest a setting for this story')
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
