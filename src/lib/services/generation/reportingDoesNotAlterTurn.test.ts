import { describe, it, expect, vi } from 'vitest'

vi.mock('$lib/stores/activity.svelte', () => ({
  activity: {
    startStep: vi.fn(() => ''),
    updateStep: vi.fn(),
    endStep: vi.fn(),
    recordStep: vi.fn(() => ''),
  },
}))
vi.mock('$lib/stores/debug.svelte', () => ({
  debug: { addDebugRequest: vi.fn(), addDebugResponse: vi.fn() },
}))
vi.mock('$lib/stores/settings.svelte', () => ({
  settings: {
    systemServicesSettings: {},
    getServiceIdForPreset: vi.fn(),
    getServiceConfig: vi.fn(),
  },
}))

import { GenerationPipeline } from './GenerationPipeline'
import { ActivityRecorder } from '$lib/services/activity'

/** Fakes for everything the pipeline reaches, recording each call's arguments. */
function fakes() {
  return {
    streamNarrative: vi.fn(async function* () {
      yield { content: 'The dragon fell.', done: false }
      yield { content: '', done: true }
    }),
    classifyResponse: vi.fn(async () => ({
      entryUpdates: {
        characterUpdates: [],
        locationUpdates: [],
        itemUpdates: [],
        storyBeatUpdates: [],
        newCharacters: [],
        newLocations: [],
        newItems: [],
        newStoryBeats: [],
      },
      scene: { currentLocationName: null, presentCharacterNames: [], timeProgression: 'none' },
    })),
    translateNarration: vi.fn(async () => ({ translatedContent: 'Il drago cadde.' })),
    generateImagesForNarrative: vi.fn(async () => ({ queued: 2 })),
    isImageGenerationEnabled: vi.fn(() => true),
    analyzeBackgroundChangeAndGenerateImage: vi.fn(async () => ({})),
    generateSuggestions: vi.fn(async () => ({ suggestions: [] })),
    translateSuggestions: vi.fn(async (s: unknown[]) => s),
    generateActionChoices: vi.fn(async () => ({ choices: [{ text: 'Run', type: 'action' }] })),
    translateActionChoices: vi.fn(async (c: unknown[]) => c),
  }
}

const context = () =>
  ({
    story: { id: 's1', settings: {}, timeTracker: null },
    visibleEntries: [],
    allEntries: [],
    worldState: { characters: [], locations: [], items: [], storyBeats: [], lorebookEntries: [] },
    userAction: { entryId: 'u1', content: 'Attack', rawInput: 'Attack' },
    narrationEntryId: 'n1',
  }) as any

const config = () =>
  ({
    rawInput: 'Attack',
    actionType: 'do',
    wasRawActionChoice: false,
    memoryRetrievalEnabled: false,
    storyMode: 'adventure',
    pov: 'second',
    tense: 'present',
    styleReview: null,
    translationSettings: {
      enabled: true,
      targetLanguage: 'it',
      translateNarration: true,
      translateSuggestions: true,
      translateActionChoices: true,
    },
    imageSettings: {
      imageGenerationMode: 'agentic',
      backgroundImagesEnabled: true,
    },
    promptContext: { mode: 'adventure', pov: 'second', tense: 'present' },
    disableSuggestions: false,
    activeThreads: [],
    cachedRetrievalResult: { combinedContext: '', timelineFillResult: null, worldStateBlock: '' },
  }) as any

/** Every call each fake received, with the step ids a reporter hands out set aside. */
function callsOf(deps: ReturnType<typeof fakes>) {
  const scrub = (_key: string, value: unknown) =>
    _key === 'activityParentId'
      ? undefined
      : typeof value === 'string' && /^step-\d+$/.test(value)
        ? ''
        : value
  return Object.fromEntries(
    Object.entries(deps).map(([name, fn]) => [
      name,
      JSON.parse(JSON.stringify(fn.mock.calls, scrub)),
    ]),
  )
}

async function run(withReporting: boolean) {
  const deps = fakes()
  let activity
  if (withReporting) {
    const recorder = new ActivityRecorder()
    recorder.setReporting('tree')
    recorder.startTurn('n1')
    activity = recorder
  }
  const events: string[] = []
  for await (const event of new GenerationPipeline({ ...deps, activity } as any).execute(
    context(),
    config(),
  )) {
    events.push(event.type)
  }
  return { calls: callsOf(deps), events }
}

describe('reporting does not alter the turn', () => {
  it('makes the same requests with the same arguments with reporting on and off', async () => {
    const off = await run(false)
    const on = await run(true)

    expect(on.calls).toEqual(off.calls)
    expect(on.events).toEqual(off.events)
    // The run reached every request, so the comparison covers them.
    for (const [name, calls] of Object.entries(off.calls)) {
      if (name === 'isImageGenerationEnabled' || name === 'generateSuggestions') continue
      if (name === 'translateSuggestions') continue
      expect(calls, name).not.toHaveLength(0)
    }
  })
})
