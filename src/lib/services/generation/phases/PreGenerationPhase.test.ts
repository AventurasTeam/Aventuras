import { describe, it, expect } from 'vitest'
import { PreGenerationPhase, type PreGenerationInput } from './PreGenerationPhase'
import type { GenerationEvent } from '../types'
import type { Character, StoryEntry } from '$lib/types'

async function drain<R>(gen: AsyncGenerator<GenerationEvent, R>) {
  const events: GenerationEvent[] = []
  for (;;) {
    const next = await gen.next()
    if (next.done) return { events, result: next.value }
    events.push(next.value)
  }
}

function makeInput(overrides: Partial<PreGenerationInput> = {}): PreGenerationInput {
  return {
    context: {
      story: {
        id: 's1',
        timeTracker: { years: 0, days: 2, hours: 8, minutes: 0 },
        settings: { visualProseMode: true },
      },
      worldState: {
        characters: [{ id: 'c1', name: 'Aria' } as Character],
        locations: [],
        items: [],
        storyBeats: [],
      },
      allEntries: [{ id: 'e1', type: 'narration', content: 'Once.' } as StoryEntry],
      userAction: { content: 'Attack' },
    } as any,
    rawInput: 'attack',
    actionType: 'do',
    wasRawActionChoice: false,
    ...overrides,
  }
}

describe('PreGenerationPhase', () => {
  const phase = new PreGenerationPhase()

  it('emits start and complete around the prepared backup', async () => {
    const { events, result } = await drain(phase.execute(makeInput()))

    expect(events.map((e) => e.type)).toEqual(['phase_start', 'phase_complete'])
    expect(result.retryBackupData.storyId).toBe('s1')
    expect(result.retryBackupData.userActionContent).toBe('Attack')
  })

  describe('the backup is a snapshot, not a view', () => {
    // Its whole purpose is to restore the state as it was *before* this turn. Holding the
    // live arrays would mean the classifier's own changes land in the backup, and a retry
    // would restore the state it was supposed to undo.

    it('copies the entry list', async () => {
      const input = makeInput()
      const { result } = await drain(phase.execute(input))

      input.context.allEntries.push({ id: 'e2' } as StoryEntry)

      expect(result.retryBackupData.entries).toHaveLength(1)
    })

    it('copies each world state collection', async () => {
      const input = makeInput()
      const { result } = await drain(phase.execute(input))

      input.context.worldState.characters.push({ id: 'c2', name: 'Borin' } as Character)
      input.context.worldState.items.push({ id: 'i1' } as any)

      expect(result.retryBackupData.characters).toHaveLength(1)
      expect(result.retryBackupData.items).toHaveLength(0)
    })
  })

  it('carries the story time into the backup', async () => {
    const { result } = await drain(phase.execute(makeInput()))

    expect(result.retryBackupData.timeTracker).toEqual({
      years: 0,
      days: 2,
      hours: 8,
      minutes: 0,
    })
  })

  it('records a missing time tracker as null rather than undefined', async () => {
    const input = makeInput()
    input.context.story.timeTracker = undefined as never

    const { result } = await drain(phase.execute(input))

    expect(result.retryBackupData.timeTracker).toBeNull()
  })

  it('reads visual prose mode from the story, defaulting to off', async () => {
    const on = await drain(phase.execute(makeInput()))
    expect(on.result.visualProseMode).toBe(true)

    const input = makeInput()
    input.context.story.settings = undefined as never
    const off = await drain(phase.execute(input))
    expect(off.result.visualProseMode).toBe(false)
  })

  it('mints a fresh streaming id per run', async () => {
    // It scopes the Visual Prose CSS for one in-flight narration; reusing it across turns
    // would let one narration's styles bleed into another.
    const first = await drain(phase.execute(makeInput()))
    const second = await drain(phase.execute(makeInput()))

    expect(first.result.streamingEntryId).not.toBe(second.result.streamingEntryId)
  })
})
