import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ContextBuilder } from './context-builder'

vi.mock('$lib/services/database', () => ({
  database: {
    getStory: vi.fn(),
    getStoryPackId: vi.fn(),
    getCharacters: vi.fn(),
    getLocations: vi.fn(),
    getItems: vi.fn(),
    getStoryBeats: vi.fn(),
    getStoryCustomVariables: vi.fn(),
    getPackVariables: vi.fn(),
    getRuntimeVariables: vi.fn(),
    getPackTemplate: vi.fn(),
  },
}))

import { database } from '$lib/services/database'

describe('ContextBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accumulates variables via add() and supports method chaining', () => {
    const builder = new ContextBuilder()
    builder.add({ mode: 'adventure' }).add({ pov: 'second', tense: 'present' })

    const ctx = builder.getContext()
    expect(ctx.mode).toBe('adventure')
    expect(ctx.pov).toBe('second')
    expect(ctx.tense).toBe('present')
  })

  it('returns a copy of context in getContext()', () => {
    const builder = new ContextBuilder()
    builder.add({ key: 'value' })
    const copy = builder.getContext()
    copy.key = 'modified'

    expect(builder.getContext().key).toBe('value')
  })

  it('resolves fallback code baseline when pack template is missing', async () => {
    vi.mocked(database.getPackTemplate).mockResolvedValue(null)

    const builder = new ContextBuilder('test-pack')
    const res = await builder.render('main-narrative')

    expect(res).toBeDefined()
    expect(typeof res.system).toBe('string')
    expect(typeof res.user).toBe('string')
  })

  it('pre-populates context for a story via forStory factory', async () => {
    vi.mocked(database.getStory).mockResolvedValue({
      id: 'story-1',
      mode: 'adventure',
      genre: 'Fantasy',
      description: 'An epic quest.',
      settings: { pov: 'second', tense: 'present', tone: 'dark' },
    } as any)

    vi.mocked(database.getStoryPackId).mockResolvedValue('default-pack')
    vi.mocked(database.getCharacters).mockResolvedValue([
      { id: 'c1', name: 'Hero', relationship: 'self', description: 'Brave hero' },
    ] as any)
    vi.mocked(database.getLocations).mockResolvedValue([
      { id: 'l1', name: 'Oakvale', current: true },
    ] as any)
    vi.mocked(database.getItems).mockResolvedValue([])
    vi.mocked(database.getStoryBeats).mockResolvedValue([])
    vi.mocked(database.getPackVariables).mockResolvedValue([])
    vi.mocked(database.getRuntimeVariables).mockResolvedValue([])

    const builder = await ContextBuilder.forStory('story-1')
    const ctx = builder.getContext()

    expect(ctx.mode).toBe('adventure')
    expect(ctx.pov).toBe('second')
    expect(ctx.protagonistName).toBe('Hero')
    expect(ctx.currentLocation).toBe('Oakvale')
  })
})
