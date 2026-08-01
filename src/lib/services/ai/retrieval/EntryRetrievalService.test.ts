import { describe, it, expect, vi } from 'vitest'
import { EntryRetrievalService } from './EntryRetrievalService'
import type { Entry, StoryEntry } from '$lib/types'

vi.mock('$lib/stores/debug.svelte', () => ({
  debug: {
    addDebugRequest: vi.fn(),
    addDebugResponse: vi.fn(),
  },
}))

vi.mock('$lib/stores/settings.svelte', () => ({
  settings: {
    systemServicesSettings: {
      entryRetrieval: {
        maxTier3Entries: 0,
        maxWordsPerEntry: 0,
        enableLLMSelection: false,
        recentEntriesCount: 5,
      },
    },
    getPresetConfig: () => ({ model: 'test-model', temperature: 0.2 }),
    getServicePresetId: () => 'preset-1',
  },
}))

describe('EntryRetrievalService', () => {
  const mockEntries: Entry[] = [
    {
      id: 'e1',
      name: 'Ancient Artifact',
      type: 'item',
      description: 'A glowing orb of celestial energy.',
      aliases: ['Orb of Power'],
      injection: { mode: 'always', priority: 100, keywords: [] },
    } as any,
    {
      id: 'e2',
      name: 'Shadow Cult',
      type: 'faction',
      description: 'A secretive group worshipping the void.',
      aliases: ['Void Worshipers'],
      injection: { mode: 'keyword', priority: 50, keywords: ['void', 'cult'] },
    } as any,
    {
      id: 'e3',
      name: 'Forbidden Magic',
      type: 'concept',
      description: 'Magic that manipulates dark forces.',
      aliases: [],
      injection: { mode: 'never', priority: 10, keywords: ['dark magic'] },
    } as any,
  ]

  const service = new EntryRetrievalService({
    enableLLMSelection: false, // Disable LLM calls for deterministic testing
  })

  it('retrieves Tier 1 entries (mode === "always")', async () => {
    const result = await service.getRelevantEntries(mockEntries, '', [])

    expect(result.tier1.map((r) => r.entry.name)).toContain('Ancient Artifact')
    expect(result.tier1.map((r) => r.entry.name)).not.toContain('Shadow Cult')
  })

  it('retrieves Tier 2 entries matched by name, alias, or keyword', async () => {
    const recentStory: StoryEntry[] = [
      { type: 'narration', content: 'We discovered a temple dedicated to the void.' } as StoryEntry,
    ]

    const result = await service.getRelevantEntries(mockEntries, 'Where is the cult?', recentStory)

    expect(result.tier2.map((r) => r.entry.name)).toContain('Shadow Cult')
    expect(result.tier2.map((r) => r.entry.name)).not.toContain('Forbidden Magic') // mode === 'never'
  })

  it('respects maxWordsPerEntry config by truncating contextBlock descriptions', async () => {
    const wordLimitedService = new EntryRetrievalService({
      maxWordsPerEntry: 3,
      enableLLMSelection: false,
    })

    const result = await wordLimitedService.getRelevantEntries(mockEntries, '', [])

    // Description is "A glowing orb of celestial energy." -> truncated to "A glowing orb [...]"
    expect(result.contextBlock).toContain('A glowing orb [...]')
  })

  it('formats context block with [LOREBOOK CONTEXT]', async () => {
    const result = await service.getRelevantEntries(mockEntries, 'void', [])

    expect(result.contextBlock).toContain('[LOREBOOK CONTEXT]')
    expect(result.contextBlock).toContain('Ancient Artifact')
    expect(result.contextBlock).toContain('Shadow Cult')
  })

  it('puts an "always" entry in the prompt no matter what else matched', async () => {
    // Regression guard for the reported bug: "always active lorebook entries... aren't".
    // Upstream, RetrievalPhase skipped this whole service when Memory Retrieval was in
    // Agentic mode, so Tier 1 never ran and `mode: 'always'` injected nothing -- the agent
    // decided the lorebook instead. The phase no longer skips it and the agent no longer
    // selects, so the guarantee is a guarantee again.
    const noMatches = await service.getRelevantEntries(mockEntries, 'nothing relevant here', [])

    expect(noMatches.tier1.map((r) => r.entry.name)).toContain('Ancient Artifact')
    expect(noMatches.contextBlock).toContain('Ancient Artifact')
    expect(noMatches.all.map((r) => r.entry.name)).toContain('Ancient Artifact')
  })

  it('never caps an "always" entry out of the prompt', async () => {
    // Tier 1 is uncapped by design; only Tiers 2 and 3 have limits.
    const alwaysEntries = Array.from({ length: 30 }, (_, i) => ({
      id: `a${i}`,
      name: `Always ${i}`,
      type: 'concept',
      description: 'Established lore.',
      aliases: [],
      injection: { mode: 'always', priority: 50, keywords: [] },
    })) as unknown as Entry[]

    const tight = new EntryRetrievalService({
      maxTier2Entries: 5,
      maxTier3Entries: 5,
      enableLLMSelection: false,
    })

    const result = await tight.getRelevantEntries(alwaysEntries, '', [])

    expect(result.tier1).toHaveLength(30)
  })

  describe('tier caps', () => {
    /** `count` entries that all match the keyword "beacon", with descending priority. */
    const keyworded = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `k${i}`,
        name: `Keyed ${i}`,
        type: 'concept',
        description: 'Lore.',
        aliases: [],
        injection: { mode: 'keyword', priority: count - i, keywords: ['beacon'] },
      })) as unknown as Entry[]

    it('caps Tier 2 at the configured limit', async () => {
      const capped = new EntryRetrievalService({ maxTier2Entries: 5, enableLLMSelection: false })

      const result = await capped.getRelevantEntries(keyworded(20), 'the beacon', [])

      expect(result.tier2).toHaveLength(5)
    })

    it('drops the lowest authored priority first, not whatever came last', async () => {
      // Without a sort this would keep Keyed 0..4 by array order. Priority descends with
      // the index, so the highest-priority five are the first five either way -- reverse
      // the pool so the two orders disagree.
      const pool = keyworded(20).reverse()
      const capped = new EntryRetrievalService({ maxTier2Entries: 3, enableLLMSelection: false })

      const result = await capped.getRelevantEntries(pool, 'the beacon', [])

      expect(result.tier2.map((r) => r.entry.name)).toEqual(['Keyed 0', 'Keyed 1', 'Keyed 2'])
    })
  })
})
