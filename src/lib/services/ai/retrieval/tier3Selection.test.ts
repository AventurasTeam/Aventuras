import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { StoryEntry } from '$lib/types'

// `tier3Selection` reaches `sdk/generate`, which transitively pulls in the debug rune store
// and fails to import under `environment: 'node'`. Mocked rather than worked around: the LLM
// call is not what these tests are about, and stubbing it is what makes the failure path
// reachable at all.
vi.mock('$lib/stores/debug.svelte', () => ({
  debug: { addDebugRequest: vi.fn(), addDebugResponse: vi.fn() },
}))

const generateStructured = vi.fn()
vi.mock('../sdk/generate', () => ({
  generateStructured: (...args: unknown[]) => generateStructured(...args),
}))

const rendered: Record<string, string>[] = []
vi.mock('$lib/services/context', () => ({
  ContextBuilder: class {
    add(vars: Record<string, string>) {
      rendered.push(vars)
    }
    async render() {
      return { system: 'system', user: 'user' }
    }
  },
}))

import {
  resolveTier3Selection,
  runTier3Selection,
  type Tier3SelectionResult,
} from './tier3Selection'

/** A candidate list in the order the prompt was built from. */
const candidates = [
  { id: 'a-uuid', name: 'Aria' },
  { id: 'b-uuid', name: 'Bramble' },
  { id: 'c-uuid', name: 'Corin' },
  { id: 'd-uuid', name: 'Dain' },
]

const selection = (...ids: string[]): Tier3SelectionResult => ({ selectedIds: new Set(ids) })

beforeEach(() => {
  generateStructured.mockReset()
  rendered.length = 0
})

describe('resolveTier3Selection', () => {
  it('matches by id', () => {
    const selected = resolveTier3Selection(candidates, selection('b-uuid', 'd-uuid'))
    expect(selected.map((c) => c.name)).toEqual(['Bramble', 'Dain'])
  })

  it('matches by numeric index, which some models return instead of ids', () => {
    const selected = resolveTier3Selection(candidates, selection('0', '2'))
    expect(selected.map((c) => c.name)).toEqual(['Aria', 'Corin'])
  })

  it('accepts a mix of ids and indices in one result', () => {
    const selected = resolveTier3Selection(candidates, selection('a-uuid', '3'))
    expect(selected.map((c) => c.name)).toEqual(['Aria', 'Dain'])
  })

  it("returns them in the model's order, not in candidate order", () => {
    // The contract both callers depend on: they cap the result, and candidate order is an
    // artifact of prompt assembly -- for WorldStateInjector it is grouped by type, so a cap
    // applied to it drops whole categories regardless of what the model thought mattered.
    const selected = resolveTier3Selection(candidates, selection('d-uuid', 'a-uuid', 'c-uuid'))
    expect(selected.map((c) => c.name)).toEqual(['Dain', 'Aria', 'Corin'])
  })

  it('ignores ids that match no candidate', () => {
    const selected = resolveTier3Selection(candidates, selection('ghost', 'b-uuid'))
    expect(selected.map((c) => c.name)).toEqual(['Bramble'])
  })

  it('ignores an index past the end of the list', () => {
    // A model that counted wrong must not take a neighbour down with it.
    expect(resolveTier3Selection(candidates, selection('99'))).toEqual([])
  })

  it('does not return a candidate twice when the model names it both ways', () => {
    const selected = resolveTier3Selection(candidates, selection('a-uuid', '0'))
    expect(selected).toHaveLength(1)
    expect(selected[0].name).toBe('Aria')
  })

  it('returns nothing for an empty selection', () => {
    expect(resolveTier3Selection(candidates, selection())).toEqual([])
  })

  it('returns nothing when there are no candidates', () => {
    expect(resolveTier3Selection([], selection('0', 'a-uuid'))).toEqual([])
  })
})

describe('runTier3Selection', () => {
  const request = {
    candidates: [
      { id: 'a-uuid', type: 'character', name: 'Aria', description: 'A swordswoman.' },
      { id: 'b-uuid', type: 'location', name: 'The Tower', description: null },
    ],
    userInput: 'She climbs the tower.',
    recentEntries: [{ type: 'narration', content: 'The tower loomed.' } as StoryEntry],
    recentEntriesCount: 5,
    presetId: 'entryRetrieval',
    serviceLabel: 'entry-retrieval-tier3',
  }

  it('returns an empty selection without calling the model when there are no candidates', async () => {
    const result = await runTier3Selection({ ...request, candidates: [] })

    expect(result).toEqual({ selectedIds: new Set() })
    expect(generateStructured).not.toHaveBeenCalled()
  })

  it('returns the ids the model selected, plus its reasoning', async () => {
    generateStructured.mockResolvedValue({ selectedIds: ['b-uuid'], reasoning: 'She is there.' })

    const result = await runTier3Selection(request)

    expect(result).toEqual({ selectedIds: new Set(['b-uuid']), reasoning: 'She is there.' })
  })

  it('numbers the candidates from zero, which is what the index fallback resolves against', () => {
    // `resolveTier3Selection` reads a bare number as a position in this list, so the prompt
    // has to be the thing that taught the model those positions.
    generateStructured.mockResolvedValue({ selectedIds: [] })

    return runTier3Selection(request).then(() => {
      const summaries = rendered.find((v) => 'entrySummaries' in v)?.entrySummaries ?? ''
      expect(summaries).toContain('0. [character] Aria')
      expect(summaries).toContain('1. [location] The Tower')
    })
  })

  it('omits the colon for a candidate with no description', async () => {
    generateStructured.mockResolvedValue({ selectedIds: [] })

    await runTier3Selection(request)

    const summaries = rendered.find((v) => 'entrySummaries' in v)?.entrySummaries ?? ''
    expect(summaries).toContain('1. [location] The Tower')
    expect(summaries).not.toContain('The Tower:')
  })

  it('returns null when the call fails, rather than throwing into the turn', async () => {
    // Both callers read null as "no Tier 3 entries". Throwing would take down a retrieval
    // stage whose other tiers succeeded.
    generateStructured.mockRejectedValue(new Error('provider is down'))

    expect(await runTier3Selection(request)).toBeNull()
  })
})
