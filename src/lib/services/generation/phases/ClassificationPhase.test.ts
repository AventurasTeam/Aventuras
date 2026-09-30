import { describe, it, expect, vi } from 'vitest'
import { ClassificationPhase, type ClassificationInput } from './ClassificationPhase'
import type { GenerationEvent } from '../types'
import type { StoryEntry } from '$lib/types'

async function drain<R>(gen: AsyncGenerator<GenerationEvent, R>) {
  const events: GenerationEvent[] = []
  for (;;) {
    const next = await gen.next()
    if (next.done) return { events, result: next.value }
    events.push(next.value)
  }
}

const entry = (id: string, content: string): StoryEntry =>
  ({ id, type: 'narration', content }) as StoryEntry

const classification = { characters: [], locations: [] } as any

function makeInput(overrides: Partial<ClassificationInput> = {}): ClassificationInput {
  return {
    narrativeContent: 'The dragon fell.',
    narrativeEntryId: 'n1',
    userActionContent: 'Attack the dragon',
    worldState: { characters: [], locations: [], items: [], storyBeats: [] } as any,
    story: { id: 's1', timeTracker: { years: 0, days: 3, hours: 9, minutes: 0 } } as any,
    visibleEntries: [entry('n0', 'Earlier.'), entry('n1', 'The dragon fell.')],
    ...overrides,
  }
}

describe('ClassificationPhase', () => {
  it('emits classification_complete and phase_complete on success', async () => {
    const phase = new ClassificationPhase({ classifyResponse: async () => classification })

    const { events, result } = await drain(phase.execute(makeInput()))

    expect(events.map((e) => e.type)).toEqual([
      'phase_start',
      'classification_complete',
      'phase_complete',
    ])
    expect(result?.classificationResult).toBe(classification)
    expect(result?.narrativeEntryId).toBe('n1')
  })

  it('keeps the narration being classified out of the chat history', async () => {
    // It is already passed as `narrativeResponse`. Leaving it in the history too would
    // show the classifier the same text twice and invite it to double-count what changed.
    const classifyResponse = vi.fn().mockResolvedValue(classification)

    await drain(new ClassificationPhase({ classifyResponse }).execute(makeInput()))

    const chatHistory = classifyResponse.mock.calls[0][4] as StoryEntry[]
    expect(chatHistory.map((e) => e.id)).toEqual(['n0'])
  })

  it('passes the story time so the classifier can advance it', async () => {
    const classifyResponse = vi.fn().mockResolvedValue(classification)

    await drain(new ClassificationPhase({ classifyResponse }).execute(makeInput()))

    expect(classifyResponse.mock.calls[0][5]).toEqual({ years: 0, days: 3, hours: 9, minutes: 0 })
  })

  it('treats a classifier failure as non-fatal', async () => {
    // World state simply does not update; the narration the user is reading stands.
    const phase = new ClassificationPhase({
      classifyResponse: async () => {
        throw new Error('provider down')
      },
    })

    const { events, result } = await drain(phase.execute(makeInput()))

    expect(result).toBeNull()
    const error = events.find((e) => e.type === 'error')
    expect(error).toMatchObject({ fatal: false, phase: 'classification' })
  })

  describe('abort', () => {
    const aborted = () => {
      const controller = new AbortController()
      controller.abort()
      return controller.signal
    }

    it('does not call the classifier when already aborted', async () => {
      const classifyResponse = vi.fn().mockResolvedValue(classification)
      const phase = new ClassificationPhase({ classifyResponse })

      const { events, result } = await drain(phase.execute(makeInput({ abortSignal: aborted() })))

      expect(classifyResponse).not.toHaveBeenCalled()
      expect(result).toBeNull()
      expect(events.map((e) => e.type)).toEqual(['phase_start', 'aborted'])
    })

    it('discards a result that arrived after the abort', async () => {
      // The turn is being thrown away, so applying its world state changes would leave
      // entities from a narration the user never sees.
      const controller = new AbortController()
      const phase = new ClassificationPhase({
        classifyResponse: async () => {
          controller.abort()
          return classification
        },
      })

      const { events, result } = await drain(
        phase.execute(makeInput({ abortSignal: controller.signal })),
      )

      expect(result).toBeNull()
      expect(events.map((e) => e.type)).not.toContain('classification_complete')
    })

    it('reports an AbortError as an abort, not an error', async () => {
      const abortError = new Error('aborted')
      abortError.name = 'AbortError'
      const phase = new ClassificationPhase({
        classifyResponse: async () => {
          throw abortError
        },
      })

      const { events } = await drain(phase.execute(makeInput()))

      expect(events.map((e) => e.type)).toEqual(['phase_start', 'aborted'])
    })
  })
})

describe('ClassificationPhase activity reporting', () => {
  it('reports the world update as a step that spans the consumer applying the result', async () => {
    const steps: { id: string; label: string; status?: string }[] = []
    const activity = {
      startStep: (label: string) => {
        const id = `s${steps.length + 1}`
        steps.push({ id, label })
        return id
      },
      endStep: (id: string, status = 'done') => {
        const step = steps.find((s) => s.id === id)
        if (step && !step.status) step.status = status
      },
      recordStep: () => '',
    }
    const gen = new ClassificationPhase({ classifyResponse: async () => classification }).execute(
      makeInput({ activity, activityParentId: 'phase' }),
    )

    let next = await gen.next()
    while (!next.done && next.value.type !== 'classification_complete') next = await gen.next()

    // Held by the consumer: the call is over, the world update is still running.
    expect(steps.map((s) => [s.label, s.status])).toEqual([
      ['Classifying', 'done'],
      ['Updating world', undefined],
    ])

    await drain(gen)
    expect(steps.find((s) => s.label === 'Updating world')?.status).toBe('done')
  })
})

describe('ClassificationPhase failure reporting', () => {
  function recorder() {
    const steps: { id: string; label: string; status?: string; detail?: string; error?: string }[] =
      []
    const activity = {
      startStep: (label: string) => {
        const id = `s${steps.length + 1}`
        steps.push({ id, label })
        return id
      },
      endStep: (id: string, status = 'done', detail?: string, error?: string | null) => {
        const step = steps.find((s) => s.id === id)
        if (!step || step.status) return
        Object.assign(step, { status, detail, error: error ?? undefined })
      },
      recordStep: () => '',
    }
    return { steps, activity }
  }
  const empty = {
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
  }

  it('fails Classifying with the reason when nothing was recovered, and flags the phase', async () => {
    const { steps, activity } = recorder()
    const phase = new ClassificationPhase({
      classifyResponse: async () => ({ ...empty, _error: '401 · invalid API key' }) as any,
    })

    const { events } = await drain(phase.execute(makeInput({ activity, activityParentId: 'p' })))

    expect(steps[0]).toMatchObject({
      label: 'Classifying',
      status: 'failed',
      error: '401 · invalid API key',
    })
    expect(events.find((e) => e.type === 'error')).toMatchObject({ fatal: false })
    // Still handed on: the consumer shows its warning and applies the empty update.
    expect(events.some((e) => e.type === 'classification_complete')).toBe(true)
  })

  it('finishes Classifying as partly applied when the result was salvaged', async () => {
    const { steps, activity } = recorder()
    const phase = new ClassificationPhase({
      classifyResponse: async () => ({ ...empty, _error: 'bad field', _salvaged: true }) as any,
    })

    const { events } = await drain(phase.execute(makeInput({ activity, activityParentId: 'p' })))

    expect(steps[0]).toMatchObject({ status: 'done', detail: 'partly applied', error: 'bad field' })
    expect(events.some((e) => e.type === 'error')).toBe(false)
  })

  it('carries the world update step on the event, and skips it when abandoned there', async () => {
    const { steps, activity } = recorder()
    const gen = new ClassificationPhase({ classifyResponse: async () => classification }).execute(
      makeInput({ activity, activityParentId: 'p' }),
    )

    let next = await gen.next()
    while (!next.done && next.value.type !== 'classification_complete') next = await gen.next()
    const applyStepId = (next.value as any).applyStepId
    await gen.return(null)

    expect(steps.find((s) => s.id === applyStepId)).toMatchObject({
      label: 'Updating world',
      status: 'skipped',
    })
  })
})
