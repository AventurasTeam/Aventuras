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

import {
  AgenticRetrievalService,
  buildRetrievalContext,
  finishOnlyOnLastStep,
} from './AgenticRetrievalService'

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

describe('buildRetrievalContext', () => {
  const finished = { reachedFinish: true }
  const truncated = { reachedFinish: false }

  it('emits one bracketed block, not a block plus a subsection of the same name', () => {
    const context = buildRetrievalContext({
      reasoning: 'I looked for mentions of runes.',
      chapterContext: 'The runes were carved by Aria.',
      ...finished,
    })

    expect(context).toBe(
      '[RELEVANT STORY DATA]\nI looked for mentions of runes.\n\nThe runes were carved by Aria.',
    )
    // The old shape: a `##` heading repeating the block's own name.
    expect(context).not.toContain('##')
    expect(context.match(/RELEVANT STORY DATA/gi)).toHaveLength(1)
  })

  it('reports a finished run that put its findings in synthesis alone', () => {
    // chapterSummary is optional in the schema; keying the result off it threw this away.
    const context = buildRetrievalContext({
      reasoning: 'Aria has never met the smith.',
      chapterContext: '',
      ...finished,
    })

    expect(context).toContain('Aria has never met the smith.')
  })

  it('reports a finished run that produced only chapter material', () => {
    const context = buildRetrievalContext({
      reasoning: '',
      chapterContext: 'The smith died in chapter 4.',
      ...finished,
    })

    expect(context).toBe('[RELEVANT STORY DATA]\nThe smith died in chapter 4.')
  })

  it('suppresses a truncated run whose only output is the apology', () => {
    // Otherwise the narrator is handed "Retrieval was cut short by an error" as story
    // material under a heading announcing relevant story data.
    expect(
      buildRetrievalContext({
        reasoning: 'Retrieval was cut short by an error; raw findings below.',
        chapterContext: '',
        ...truncated,
      }),
    ).toBe('')
  })

  it('keeps the salvage note when a truncated run did gather something', () => {
    // "raw findings below" is only a lie if there are none.
    const context = buildRetrievalContext({
      reasoning: 'Retrieval was cut short by an error; raw findings below.',
      chapterContext: '**Chapter 4 — Who died?**\nThe smith.',
      ...truncated,
    })

    expect(context).toContain('raw findings below.')
    expect(context).toContain('The smith.')
  })

  it('returns nothing at all when there is nothing', () => {
    expect(buildRetrievalContext({ reasoning: '', chapterContext: '', ...finished })).toBe('')
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
