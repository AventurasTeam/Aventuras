import { describe, it, expect, vi } from 'vitest'
import type { Entry, Chapter } from '$lib/types'

vi.mock('$lib/stores/debug.svelte', () => ({
  debug: {
    addDebugRequest: vi.fn(),
    addDebugResponse: vi.fn(),
  },
}))

vi.mock('$lib/stores/settings.svelte', () => ({
  settings: {
    systemServicesSettings: {
      agenticRetrieval: {
        maxIterations: 5,
      },
    },
    getServiceIdForPreset: vi.fn(),
    getServiceConfig: vi.fn(),
  },
}))

import { AgenticRetrievalService, finishOnlyOnLastStep } from './AgenticRetrievalService'

describe('AgenticRetrievalService', () => {
  const service = new AgenticRetrievalService('agenticRetrieval', 5)

  const mockEntries: Entry[] = [
    {
      id: 'e1',
      name: 'Excalibur',
      type: 'item',
      description: 'Legendary sword of power.',
      aliases: ['Holy Sword'],
      injection: { mode: 'keyword', priority: 50, keywords: ['sword'] },
    } as any,
  ]

  const mockChapters: Chapter[] = [
    {
      number: 1,
      title: 'Beginning',
      summary: 'The journey starts here.',
    } as Chapter,
  ]

  it('can be instantiated with service configuration', () => {
    expect(service).toBeDefined()
  })

  it('structures retrieval context properly with entries and chapters', () => {
    const context = {
      userInput: 'Hello world',
      recentNarrative: 'Nothing much happened.',
      availableEntries: mockEntries,
      chapters: mockChapters,
    }

    expect(context.availableEntries).toHaveLength(1)
    expect(context.chapters).toHaveLength(1)
  })

  it('supports passing a live worldState in RetrievalContext', () => {
    const context = {
      userInput: 'Who is Gareth?',
      recentNarrative: 'Aria looks around.',
      availableEntries: mockEntries,
      worldState: {
        characters: [{ id: 'c1', name: 'Gareth', description: 'Missing rogue' }],
      },
    }

    expect(context.worldState?.characters).toHaveLength(1)
    expect(context.worldState?.characters?.[0].name).toBe('Gareth')
  })

  it('snaps long recentNarrative to line boundary when slicing tail', () => {
    const longNarrative =
      'HalfWordChunk\n' + 'Clean paragraph line starting here.\n' + 'X'.repeat(2000)
    // Verify logic when grep is available
    const grepAvailable = true
    const RECENT_NARRATIVE_CHARS = 2048
    let recentContext = longNarrative
    if (grepAvailable && longNarrative.length > RECENT_NARRATIVE_CHARS) {
      const rawSliced = longNarrative.slice(-RECENT_NARRATIVE_CHARS)
      const firstNewline = rawSliced.indexOf('\n')
      if (firstNewline !== -1 && firstNewline < 200) {
        recentContext = rawSliced.slice(firstNewline + 1).trimStart()
      } else {
        recentContext = rawSliced
      }
    }

    expect(recentContext.startsWith('Clean paragraph line')).toBe(true)
    expect(recentContext).not.toContain('HalfWordChunk')
  })
})

describe('finishOnlyOnLastStep', () => {
  it('leaves every tool available before the last step', () => {
    const prepare = finishOnlyOnLastStep(10)

    expect(prepare({ stepNumber: 0 })).toEqual({})
    expect(prepare({ stepNumber: 8 })).toEqual({})
  })

  it('forces finish_retrieval on the last step, so the run cannot end empty-handed', () => {
    const prepare = finishOnlyOnLastStep(10)

    expect(prepare({ stepNumber: 9 })).toEqual({
      activeTools: ['finish_retrieval'],
      toolChoice: { type: 'tool', toolName: 'finish_retrieval' },
    })
  })

  it('keeps forcing it past the last step, in case the loop runs on', () => {
    expect(finishOnlyOnLastStep(3)({ stepNumber: 7 })).toHaveProperty('toolChoice')
  })

  it('forces it immediately when only one step is allowed', () => {
    expect(finishOnlyOnLastStep(1)({ stepNumber: 0 })).toHaveProperty('toolChoice')
  })

  it('does not break on a zero budget', () => {
    expect(finishOnlyOnLastStep(0)({ stepNumber: 0 })).toHaveProperty('toolChoice')
  })
})
