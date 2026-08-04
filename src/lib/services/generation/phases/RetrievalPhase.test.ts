import { describe, it, expect, vi } from 'vitest'
import { RetrievalPhase, type RetrievalDependencies } from './RetrievalPhase'
import type { GenerationContext } from '../types'
import type { Chapter, StoryEntry } from '$lib/types'

function makeMockContext(overrides: Partial<GenerationContext> = {}): GenerationContext {
  return {
    worldState: {
      chapters: [{ number: 1, summary: 'Chapter 1' } as Chapter],
      lorebookEntries: [
        {
          id: 'l1',
          name: 'Excalibur',
          type: 'item',
          description: 'Holy sword',
          injection: { keywords: ['excalibur'], priority: 5, mode: 'keyword' },
        } as any,
      ],
      memoryConfig: { enableRetrieval: true } as any,
    } as any,
    visibleEntries: [{ type: 'narration', content: 'Hero drew Excalibur.' } as StoryEntry],
    // Needed: runMemoryRetrieval reads story.timeTracker to anchor the agent's time
    // reasoning. Without it the agentic branch throws, the non-fatal catch swallows it, and
    // the fallback test below passes for the wrong reason.
    story: { id: 's1', timeTracker: null } as any,
    userAction: { type: 'do', content: 'Attack the dragon with Excalibur' },
    abortSignal: new AbortController().signal,
    ...overrides,
  } as GenerationContext
}

function makeMockDependencies(
  overrides: Partial<RetrievalDependencies> = {},
): RetrievalDependencies {
  return {
    shouldUseAgenticRetrieval: () => false,
    runAgenticRetrieval: async () => ({ context: '## Agentic Context' }),
    runTimelineFill: async () =>
      ({
        queries: [],
        responses: [],
        contextBlock: '## Timeline Context',
      }) as any,
    answerChapterQuestion: async () => 'Answer',
    buildWorldStateContext: async () => ({
      contextBlock: '## World State',
      all: [{ type: 'character', name: 'Aria' }],
    }),
    getRelevantLorebookEntries: async () => ({
      tier1: [],
      tier2: [],
      tier3: [],
      all: [],
      contextBlock: '## Lorebook Context',
    }),
    ...overrides,
  }
}

describe('RetrievalPhase', () => {
  const phase = () => new RetrievalPhase()

  it('executes memory retrieval and lorebook retrieval in parallel', async () => {
    const phase = new RetrievalPhase()
    const context = makeMockContext()
    const deps = makeMockDependencies()

    const events: any[] = []
    let finalResult: any = null

    const gen = phase.execute({
      context,
      dependencies: deps,
      memoryRetrievalEnabled: true,
    })

    for await (const event of gen) {
      events.push(event)
      if (event.type === 'phase_complete') {
        finalResult = event.result
      }
    }

    expect(events[0].type).toBe('phase_start')
    expect(events[1].type).toBe('phase_complete')
    expect(finalResult.timelineFillResult.contextBlock).toBe('## Timeline Context')
    expect(finalResult.lorebookContext).toBe('## Lorebook Context')
    expect(finalResult.worldStateBlock).toBe('## World State')
  })

  it('injects world state even when the agent handles the lorebook', async () => {
    // World state has no "the agent does it instead" path: its candidates are live entities
    // the agent is never shown, so Task 0 is unconditional.
    const phase = new RetrievalPhase()
    const deps = makeMockDependencies({ shouldUseAgenticRetrieval: () => true })

    let finalResult: any = null
    for await (const event of phase.execute({
      context: makeMockContext(),
      dependencies: deps,
      memoryRetrievalEnabled: true,
    })) {
      if (event.type === 'phase_complete') finalResult = event.result
    }

    expect(finalResult.worldStateBlock).toBe('## World State')
  })

  it('keeps the world state block separate from the memory blocks', async () => {
    // Pre-joining them would make it impossible to tell the retrieval agent what world
    // state the narrator already has -- see RetrievalResult.worldStateBlock.
    const phase = new RetrievalPhase()

    let finalResult: any = null
    for await (const event of phase.execute({
      context: makeMockContext(),
      dependencies: makeMockDependencies(),
      memoryRetrievalEnabled: true,
    })) {
      if (event.type === 'phase_complete') finalResult = event.result
    }

    expect(finalResult.combinedContext).not.toContain('## World State')
  })

  it('runs lorebook retrieval in agentic mode too, with nothing to fall back to', async () => {
    // The agent used to select entries, so Task 2 was skipped on its behalf and a fallback
    // caught the case where it delivered nothing. `select_entry` is gone: entry selection
    // has one owner, so lorebook retrieval is unconditional and the fallback is unnecessary.
    const phase = new RetrievalPhase()
    const lorebookSpy = vi.fn().mockResolvedValue({
      tier1: [],
      tier2: [],
      tier3: [],
      all: [],
      contextBlock: '## Lorebook Context',
    })

    const deps = makeMockDependencies({
      shouldUseAgenticRetrieval: () => true,
      runAgenticRetrieval: async () => ({ context: '' }),
      getRelevantLorebookEntries: lorebookSpy,
    })

    let finalResult: any = null
    for await (const event of phase.execute({
      context: makeMockContext(),
      dependencies: deps,
      memoryRetrievalEnabled: true,
    })) {
      if (event.type === 'phase_complete') finalResult = event.result
    }

    // Called exactly once: a second call would mean the fallback path came back.
    expect(lorebookSpy).toHaveBeenCalledTimes(1)
    expect(finalResult.lorebookContext).toBe('## Lorebook Context')
  })

  it('gives memory retrieval the summary of what stage A already put in the prompt', async () => {
    const agenticSpy = vi.fn().mockResolvedValue({ context: '## Agentic' })

    const deps = makeMockDependencies({
      shouldUseAgenticRetrieval: () => true,
      runAgenticRetrieval: agenticSpy,
      getRelevantLorebookEntries: async () => ({
        tier1: [],
        tier2: [],
        tier3: [],
        all: [{ entry: { name: 'The Orcs', type: 'faction' }, tier: 2, priority: 1 } as any],
        contextBlock: '## Lorebook Context',
      }),
    })

    for await (const _ of phase().execute({
      context: makeMockContext(),
      dependencies: deps,
      memoryRetrievalEnabled: true,
    })) {
      // drain
    }

    const { alreadyInContext } = agenticSpy.mock.calls[0][0]
    expect(alreadyInContext).toContain('[character] Aria')
    expect(alreadyInContext).toContain('[faction] The Orcs')
  })

  it('omits the summary entirely when half of stage A failed', async () => {
    // Naming only the lorebook half would state that world state contributed nothing,
    // sending the agent off to rediscover the scene it is standing in.
    const agenticSpy = vi.fn().mockResolvedValue({ context: '## Agentic' })

    const deps = makeMockDependencies({
      shouldUseAgenticRetrieval: () => true,
      runAgenticRetrieval: agenticSpy,
      buildWorldStateContext: async () => {
        throw new Error('world state injection blew up')
      },
    })

    for await (const _ of phase().execute({
      context: makeMockContext(),
      dependencies: deps,
      memoryRetrievalEnabled: true,
    })) {
      // drain
    }

    expect(agenticSpy.mock.calls[0][0].alreadyInContext).toBe('')
  })

  it('hands lorebook retrieval the full history, leaving the window to its own setting', async () => {
    const lorebookSpy = vi.fn().mockResolvedValue({
      tier1: [],
      tier2: [],
      tier3: [],
      all: [],
      contextBlock: '',
    })
    const context = makeMockContext()

    for await (const _ of phase().execute({
      context,
      dependencies: makeMockDependencies({ getRelevantLorebookEntries: lorebookSpy }),
      memoryRetrievalEnabled: true,
    })) {
      // drain
    }

    expect(lorebookSpy.mock.calls[0][2]).toBe(context.visibleEntries)
  })

  it('runs memory retrieval only after stage A, so the summary is complete', async () => {
    // A partial summary is worse than none: it is read as a statement about the prompt, so
    // naming half of it invites work on the other half under the impression it is missing.
    const order: string[] = []

    const deps = makeMockDependencies({
      shouldUseAgenticRetrieval: () => true,
      buildWorldStateContext: async () => {
        order.push('worldState')
        return { contextBlock: '## World State', all: [] }
      },
      getRelevantLorebookEntries: async () => {
        order.push('lorebook')
        return { tier1: [], tier2: [], tier3: [], all: [], contextBlock: '## Lorebook' }
      },
      runAgenticRetrieval: async () => {
        order.push('memory')
        return { context: '## Agentic', transcript: 't' }
      },
    })

    for await (const _ of phase().execute({
      context: makeMockContext(),
      dependencies: deps,
      memoryRetrievalEnabled: true,
    })) {
      // drain
    }

    expect(order.indexOf('memory')).toBe(2)
    expect(order.slice(0, 2).sort()).toEqual(['lorebook', 'worldState'])
  })

  it('passes the summary to static timeline fill too', async () => {
    const timelineSpy = vi.fn().mockResolvedValue({ queries: [], responses: [] })
    const deps = makeMockDependencies({
      shouldUseAgenticRetrieval: () => false,
      runTimelineFill: timelineSpy,
    })

    for await (const _ of phase().execute({
      context: makeMockContext(),
      dependencies: deps,
      memoryRetrievalEnabled: true,
    })) {
      // drain
    }

    expect(timelineSpy.mock.calls[0][2]).toContain('[character] Aria')
  })

  it('emits aborted event when abortSignal is triggered', async () => {
    const phase = new RetrievalPhase()
    const controller = new AbortController()
    controller.abort()

    const context = makeMockContext({ abortSignal: controller.signal })
    const deps = makeMockDependencies()

    const events: any[] = []
    for await (const event of phase.execute({
      context,
      dependencies: deps,
      memoryRetrievalEnabled: true,
    })) {
      events.push(event)
    }

    expect(events.some((e) => e.type === 'aborted')).toBe(true)
  })
})
