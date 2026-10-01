import { describe, it, expect, vi } from 'vitest'
import type { Chapter, TimeTracker } from '$lib/types'

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
    serviceSpecificSettings: {},
    advancedRequestSettings: { manualMode: false },
  },
}))

import { buildChapterSummariesBlock, joinReinforcement, narrativeChunks } from './NarrativeService'

describe('joinReinforcement', () => {
  it('prefixes the turn message when the pack rendered reinforcement', () => {
    expect(joinReinforcement('You are the narrator.', '## Current Action:\ngo north')).toBe(
      'You are the narrator.\n\n## Current Action:\ngo north',
    )
  })

  it('leaves the message untouched when nothing rendered', () => {
    expect(joinReinforcement('', '## Current Action:\ngo north')).toBe(
      '## Current Action:\ngo north',
    )
  })

  it('leaves the message untouched when only whitespace rendered', () => {
    // The likelier shape of `none`: the level's branches all miss and Liquid leaves the
    // newlines between them behind.
    expect(joinReinforcement('\n\n', '## Current Action:\ngo north')).toBe(
      '## Current Action:\ngo north',
    )
    expect(joinReinforcement('   \n \t\n', '## Current Action:\ngo north')).toBe(
      '## Current Action:\ngo north',
    )
  })

  it('sends the untrimmed reinforcement, since trimming would change what full has always sent', () => {
    expect(joinReinforcement('  padded  ', 'story')).toBe('  padded  \n\nstory')
  })
})

const t = (years: number, days: number, hours: number, minutes: number): TimeTracker => ({
  years,
  days,
  hours,
  minutes,
})

const chapter = (overrides: Partial<Chapter> = {}): Chapter =>
  ({
    number: 1,
    title: null,
    summary: 'Aria leaves.',
    characters: [],
    locations: [],
    ...overrides,
  }) as Chapter

describe('buildChapterSummariesBlock — chapter times', () => {
  it('renders a span when both ends are recorded', () => {
    const block = buildChapterSummariesBlock([
      chapter({ startTime: t(0, 3, 8, 0), endTime: t(0, 5, 19, 30) }),
    ])

    expect(block).toContain('*Time: Year 1, Day 4, 08:00 → Year 1, Day 6, 19:30*')
  })

  it('collapses to one instant when no time passed', () => {
    const time = t(0, 3, 8, 0)
    const block = buildChapterSummariesBlock([chapter({ startTime: time, endTime: time })])

    expect(block).toContain('*Time: Year 1, Day 4, 08:00*')
    expect(block).not.toContain('→')
  })

  it('does not invent an end time for a chapter that only recorded its start', () => {
    // The local formatter this replaced defaulted a missing time to the start of the
    // story and never returned empty, so the "start only" branch was unreachable and the
    // narrator was told the chapter *ended* at Year 1, Day 1.
    const block = buildChapterSummariesBlock([
      chapter({ startTime: t(2, 40, 9, 0), endTime: null }),
    ])

    expect(block).toContain('*Time: Year 3, Day 41, 09:00*')
    expect(block).not.toContain('Year 1, Day 1')
    expect(block).not.toContain('→')
  })

  it('survives a chapter persisted before the metadata fields existed', () => {
    // `characters`/`locations` are non-optional on the type, but chapters are stored as
    // JSON: one written by an older version arrives without them, and this block runs on
    // every narrator turn.
    const old = { number: 1, title: null, summary: 'Aria leaves.' } as Chapter

    expect(() => buildChapterSummariesBlock([old])).not.toThrow()
    expect(buildChapterSummariesBlock([old])).toContain('Aria leaves.')
  })

  it('omits the line entirely when no time is recorded', () => {
    const block = buildChapterSummariesBlock([chapter({ startTime: null, endTime: null })])

    expect(block).not.toContain('*Time:')
  })
})

describe('narrativeChunks', () => {
  async function collect(parts: { type: string; text?: string; error?: unknown }[]) {
    const out = []
    for await (const chunk of narrativeChunks(
      (async function* () {
        yield* parts
      })(),
    ))
      out.push(chunk)
    return out
  }

  it('marks the start of the response, then passes reasoning and text on', async () => {
    expect(
      await collect([
        { type: 'start' },
        { type: 'start-step' },
        { type: 'reasoning-delta', text: 'hm' },
        { type: 'text-delta', text: 'Hi.' },
        { type: 'finish' },
      ]),
    ).toEqual([
      { content: '', done: false, started: true },
      { content: '', reasoning: 'hm', done: false },
      { content: 'Hi.', done: false },
    ])
  })

  it('throws a failed request instead of passing it on as an empty answer', async () => {
    const failure = new Error('401 · Invalid API key provided.')
    await expect(collect([{ type: 'start' }, { type: 'error', error: failure }])).rejects.toBe(
      failure,
    )
  })

  it("throws a provider's in-stream error object as an error with its message", async () => {
    const error = { message: 'Upstream provider stopped responding', code: 502 }
    await expect(collect([{ type: 'error', error }])).rejects.toThrow(
      '502 · Upstream provider stopped responding',
    )
  })
})
