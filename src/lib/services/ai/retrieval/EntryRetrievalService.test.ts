import { describe, it, expect, vi } from 'vitest'
import { EntryRetrievalService, SimpleActivationTracker } from './EntryRetrievalService'
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

  describe('Tier 2 — scene crossfeed and second pass', () => {
    const entry = (id: string, name: string, keywords: string[] = []): Entry =>
      ({
        id,
        name,
        type: 'concept',
        description: 'Lore.',
        aliases: [],
        injection: { mode: 'keyword', priority: 10, keywords },
      }) as unknown as Entry

    // 'Rusthaven' matches the action; 'Siren Docks' names Rusthaven and nothing else, so it
    // can only arrive on the second pass.
    const linkedEntries = [
      entry('l1', 'Rusthaven', ['harbour']),
      entry('l2', 'Siren Docks', ['Rusthaven']),
    ]
    const action = 'We reach the harbour.'

    it('matches lore against what the world state put in the scene', async () => {
      // Nobody typed "Morvana", but she is standing there, so her house entry is relevant.
      const entries = [entry('l1', 'House of Stone', ['Morvana'])]

      const result = await service.getRelevantEntries(entries, 'I look around.', [], {
        sceneEntities: [{ type: 'character', name: 'Morvana' }],
      })

      expect(result.tier2.map((r) => r.entry.name)).toEqual(['House of Stone'])
    })

    it('reports a scene match as second-pass, not as something the text named', async () => {
      // It arrived because a character happens to be standing there, which is relevance at
      // one remove — the same thing `viaScene` marks for a name-chained hit. Folded into
      // the first-pass haystack it was indistinguishable from a word the player typed:
      // same priority, same "matched:" reason, and invisible to the panel's split.
      const entries = [
        entry('l1', 'House of Stone', ['Morvana']),
        entry('l2', 'The Harbour', ['harbour']),
      ]

      const result = await service.getRelevantEntries(entries, 'We reach the harbour.', [], {
        sceneEntities: [{ type: 'character', name: 'Morvana' }],
      })

      const byName = new Map(result.tier2.map((r) => [r.entry.name, r]))
      expect(byName.get('House of Stone')?.viaScene).toBe(true)
      expect(byName.get('The Harbour')?.viaScene).toBe(false)
      expect(byName.get('The Harbour')!.priority).toBeGreaterThan(
        byName.get('House of Stone')!.priority,
      )
    })

    it('ignores the scene entirely when the crossfeed is switched off', async () => {
      const entries = [entry('l1', 'House of Stone', ['Morvana'])]
      const noCrossfeed = new EntryRetrievalService({
        enableLLMSelection: false,
        useSceneEntities: false,
      })

      const result = await noCrossfeed.getRelevantEntries(entries, 'I look around.', [], {
        sceneEntities: [{ type: 'character', name: 'Morvana' }],
      })

      expect(result.tier2).toEqual([])
    })

    it('still runs the name-chained second pass with the crossfeed off', async () => {
      // The switch governs one seed source, not the pass itself.
      const noCrossfeed = new EntryRetrievalService({
        enableLLMSelection: false,
        useSceneEntities: false,
      })

      const result = await noCrossfeed.getRelevantEntries(linkedEntries, action, [])

      expect(result.tier2.map((r) => r.entry.name).sort()).toEqual(['Rusthaven', 'Siren Docks'])
    })

    it('finds an entry named only by another entry the first pass matched', async () => {
      const result = await service.getRelevantEntries(linkedEntries, action, [])

      expect(result.tier2.map((r) => r.entry.name).sort()).toEqual(['Rusthaven', 'Siren Docks'])
    })

    it('ranks a second-pass hit below the first-pass one that led to it', async () => {
      const result = await service.getRelevantEntries(linkedEntries, action, [])

      const [first, second] = result.tier2
      expect(first.entry.name).toBe('Rusthaven')
      expect(first.priority).toBeGreaterThan(second.priority)
      expect(second.viaScene).toBe(true)
      expect(first.viaScene).toBe(false)
    })

    it('does not run a third pass: a second-pass hit is not a seed', async () => {
      // Otherwise a dense lorebook pulls itself in entirely, one reference at a time.
      const result = await service.getRelevantEntries(
        [...linkedEntries, entry('l3', 'Harbour Watch', ['Siren Docks'])],
        action,
        [],
      )

      expect(result.tier2.map((r) => r.entry.name)).not.toContain('Harbour Watch')
    })

    it('does not seed on a name too short to mean anything', async () => {
      // 'Zyl' would match wherever those three letters fall inside a longer word.
      const result = await service.getRelevantEntries(
        [entry('s1', 'Zyl', ['archivist']), entry('s2', 'Zyl Archive', ['Zyl'])],
        'The archivist arrives.',
        [],
      )

      expect(result.tier2.map((r) => r.entry.name)).toEqual(['Zyl'])
    })
  })

  describe('Tier 3 — the volume question, before the relevance one', () => {
    /** Pinned so the fixtures do not have to track the shipped default. */
    const BUDGET = 400

    /** `count` unmatched entries, each carrying `words` words of description. */
    const uncovered = (count: number, words: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `u${i}`,
        name: `Unmatched${i}`,
        type: 'concept',
        description: Array.from({ length: words }, () => 'lore').join(' '),
        aliases: [],
        injection: { mode: 'keyword', priority: 10, keywords: ['nothing-matches-this'] },
      })) as unknown as Entry[]

    it('includes a cheap leftover wholesale, without an LLM call', async () => {
      // Two entries of 40 words each are well under the budget, so the call the
      // model would have been paid for buys nothing that including them does not.
      const service = new EntryRetrievalService({
        enableLLMSelection: true,
        tier3WholesaleWordBudget: BUDGET,
      })
      const llm = vi.spyOn(
        service as unknown as { getLLMSelectedEntries: () => Promise<[]> },
        'getLLMSelectedEntries',
      )

      const result = await service.getRelevantEntries(uncovered(2, 40), '', [])

      expect(result.tier3.map((r) => r.entry.name)).toEqual(['Unmatched0', 'Unmatched1'])
      expect(llm).not.toHaveBeenCalled()
    })

    it('measures the leftover in words, not in entries', async () => {
      // The distinction the old `remaining < 3` rule could not make: three entries is a
      // small leftover by count and an expensive one by content.
      const service = new EntryRetrievalService({
        enableLLMSelection: true,
        tier3WholesaleWordBudget: BUDGET,
      })
      const llm = vi
        .spyOn(
          service as unknown as { getLLMSelectedEntries: () => Promise<[]> },
          'getLLMSelectedEntries',
        )
        .mockResolvedValue([])

      await service.getRelevantEntries(uncovered(3, 300), '', [])

      expect(llm).toHaveBeenCalled()
    })

    it('charges for bare names too, so a description-free pool cannot slip through', async () => {
      // Counting descriptions alone priced these at zero words, so all 500 fitted any
      // budget and went into the prompt wholesale. One name is one word.
      const service = new EntryRetrievalService({
        enableLLMSelection: true,
        tier3WholesaleWordBudget: BUDGET,
      })
      const llm = vi
        .spyOn(
          service as unknown as { getLLMSelectedEntries: () => Promise<[]> },
          'getLLMSelectedEntries',
        )
        .mockResolvedValue([])

      await service.getRelevantEntries(uncovered(500, 0), '', [])

      expect(llm).toHaveBeenCalled()
    })

    it('drops an over-budget leftover when LLM selection is switched off', async () => {
      // There is no third option: too much to include, and nobody to ask.
      const off = new EntryRetrievalService({
        enableLLMSelection: false,
        tier3WholesaleWordBudget: BUDGET,
      })

      const result = await off.getRelevantEntries(uncovered(3, 300), '', [])

      expect(result.tier3).toEqual([])
    })

    it('still includes a cheap leftover when LLM selection is switched off', async () => {
      // Including what is already in hand is not a selection, so the switch does not gate
      // it -- the coverage rule this replaced could drop a leftover on either setting.
      const off = new EntryRetrievalService({
        enableLLMSelection: false,
        tier3WholesaleWordBudget: BUDGET,
      })

      const result = await off.getRelevantEntries(uncovered(2, 40), '', [])

      expect(result.tier3).toHaveLength(2)
    })

    it('does not activate a wholesale leftover, because cheap is not relevant', async () => {
      // Stickiness carries an entry forward *because something noticed it*. Wholesale
      // inclusion notices nothing -- it means the leftover was small. Recording it made
      // every uncovered entry sticky every turn on any story under the budget, which
      // promotes the whole lorebook into Tier 1 and empties the word "always" of meaning.
      const service = new EntryRetrievalService({
        enableLLMSelection: true,
        tier3WholesaleWordBudget: BUDGET,
      })
      const tracker = new SimpleActivationTracker(10)
      const record = vi.spyOn(tracker, 'recordActivation')

      const result = await service.getRelevantEntries(uncovered(2, 40), '', [], {
        activationTracker: tracker,
      })

      expect(result.tier3).toHaveLength(2)
      expect(record).not.toHaveBeenCalled()
    })

    it('does activate a leftover the model actually chose', async () => {
      // The other half of the same rule: a Tier 3 pick is as much a relevance signal as a
      // Tier 2 keyword match, and used to be strictly less durable than one.
      const service = new EntryRetrievalService({
        enableLLMSelection: true,
        tier3WholesaleWordBudget: BUDGET,
      })
      const entries = uncovered(3, 300)
      vi.spyOn(
        service as unknown as {
          getLLMSelectedEntries: () => Promise<{ entry: Entry; tier: number; priority: number }[]>
        },
        'getLLMSelectedEntries',
      ).mockResolvedValue([{ entry: entries[1], tier: 3, priority: 60 }])

      const tracker = new SimpleActivationTracker(10)
      const record = vi.spyOn(tracker, 'recordActivation')

      await service.getRelevantEntries(entries, '', [], { activationTracker: tracker })

      expect(record).toHaveBeenCalledWith(entries[1].id, 10)
    })
  })
})
