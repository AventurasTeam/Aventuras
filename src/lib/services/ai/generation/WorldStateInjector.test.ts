import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WorldStateInjector } from './WorldStateInjector'
import type { Character, Location, Item, StoryBeat, StoryEntry } from '$lib/types'

vi.mock('$lib/stores/debug.svelte', () => ({
  debug: {
    addDebugRequest: vi.fn(),
    addDebugResponse: vi.fn(),
  },
}))

// The LLM half of Tier 3, stubbed: these tests are about *when* it is called, and
// calling it for real would drag in the prompt engine and a provider.
const runTier3Selection = vi.fn()
vi.mock('../retrieval/tier3Selection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../retrieval/tier3Selection')>()),
  runTier3Selection: (...args: unknown[]) => runTier3Selection(...args),
}))

vi.mock('$lib/stores/settings.svelte', () => ({
  settings: {
    getServicePresetId: () => 'context',
    systemServicesSettings: {
      worldStateInjection: {
        tier3WholesaleWordBudget: 500,
        maxEntriesPerTier: 5,
        enableLLMSelection: false,
        recentEntriesCount: 5,
      },
    },
  },
}))

describe('WorldStateInjector', () => {
  const characters = [
    {
      id: 'c1',
      name: 'Aria',
      status: 'active',
      relationship: 'Ally',
      description: 'Master swordsman',
    },
    {
      id: 'c2',
      name: 'Borin',
      status: 'inactive',
      relationship: 'Dwarf blacksmith',
      description: 'Stout warrior',
    },
  ] as Character[]

  const locations = [
    {
      id: 'l1',
      name: 'Oakvale',
      current: true,
      description: 'Peaceful village surrounded by oaks',
    },
    { id: 'l2', name: 'Iron Mountain', current: false, description: 'Cold peak' },
  ] as Location[]

  const items = [
    {
      id: 'i1',
      name: 'Sunblade',
      location: 'inventory',
      equipped: true,
      description: 'Glowing golden sword',
    },
    {
      id: 'i2',
      name: 'Shield of Dawn',
      location: 'ground',
      equipped: false,
      description: 'Sturdy iron shield',
    },
  ] as Item[]

  const storyBeats = [
    {
      id: 'b1',
      title: 'Save the village',
      status: 'active',
      type: 'quest',
      description: 'Defend Oakvale',
    },
  ] as StoryBeat[]

  const worldState = {
    characters,
    locations,
    items,
    storyBeats,
    currentLocation: locations[0],
  }

  const injector = new WorldStateInjector({
    enableLLMSelection: false, // Disable Tier 3 LLM calls for unit tests
  })

  it('selects Tier 1 entities (current location, present/active characters, equipped items, active story beats)', async () => {
    const result = await injector.buildContext(worldState, '', [])

    expect(result.tier1.map((e) => e.name)).toContain('Oakvale')
    expect(result.tier1.map((e) => e.name)).toContain('Aria')
    expect(result.tier1.map((e) => e.name)).toContain('Sunblade')
    expect(result.tier1.map((e) => e.name)).toContain('Save the village')
    expect(result.tier1.map((e) => e.name)).not.toContain('Borin')
  })

  it('selects Tier 2 entities via fuzzy matching against user input and recent narrative', async () => {
    const recentEntries: StoryEntry[] = [
      {
        type: 'narration',
        content: 'We need to travel to Iron Mountain to meet Borin.',
      } as StoryEntry,
    ]

    const result = await injector.buildContext(worldState, 'Borin, are you ready?', recentEntries)

    // Borin is Inactive, but mentioned in user input / recent narrative -> Tier 2
    expect(result.tier2.map((e) => e.name)).toContain('Borin')
    expect(result.tier2.map((e) => e.name)).toContain('Iron Mountain')
  })

  it('builds a formatted context block containing selected entities', async () => {
    const result = await injector.buildContext(worldState, 'Borin', [])

    expect(result.contextBlock).toContain('[CURRENT LOCATION]')
    expect(result.contextBlock).toContain('Oakvale')
    expect(result.contextBlock).toContain('Aria')
    expect(result.contextBlock).toContain('Sunblade')
    expect(result.contextBlock).toContain('Borin')
  })

  describe('Tier 3 — the overflow valve', () => {
    // Uncovered by tiers 1 and 2 in this fixture: Borin (inactive, unmentioned),
    // Iron Mountain (not current, unmentioned), Shield of Dawn (not in inventory).
    const uncovered = ['Borin', 'Iron Mountain', 'Shield of Dawn']

    beforeEach(() => runTier3Selection.mockReset())

    it('includes everything left over when it fits under the budget', async () => {
      // The whole point of the fix: a small leftover used to be dropped outright, so a
      // small story was served *worse* than a large one.
      const small = new WorldStateInjector({
        tier3WholesaleWordBudget: 1000,
        enableLLMSelection: true,
      })

      const result = await small.buildContext(worldState, '', [])

      expect(result.tier3.map((e) => e.name).sort()).toEqual([...uncovered].sort())
      expect(runTier3Selection).not.toHaveBeenCalled()
    })

    it('does so without an LLM call even when LLM selection is switched off', async () => {
      // Including what is already in hand is not a selection, so the switch does not gate it.
      const off = new WorldStateInjector({
        tier3WholesaleWordBudget: 1000,
        enableLLMSelection: false,
      })

      const result = await off.buildContext(worldState, '', [])

      expect(result.tier3.map((e) => e.name).sort()).toEqual([...uncovered].sort())
      expect(runTier3Selection).not.toHaveBeenCalled()
    })

    const worldStateLarge = {
      ...worldState,
      items: [
        ...items,
        {
          id: 'i3',
          name: 'Ring of Power',
          location: 'ground',
          equipped: false,
          description: 'Gold ring',
        },
        {
          id: 'i4',
          name: 'Magic Wand',
          location: 'ground',
          equipped: false,
          description: 'Wood wand',
        },
        {
          id: 'i5',
          name: 'Iron Helmet',
          location: 'ground',
          equipped: false,
          description: 'Steel cap',
        },
      ] as Item[],
    }

    it('asks the model which of the leftovers matter once there are too many to include', async () => {
      // '0' is an index into the candidate list, which `collectRemainingCandidates`
      // groups by type: [Borin, Iron Mountain, Shield of Dawn, Ring, Wand, Helmet].
      runTier3Selection.mockResolvedValue({ selectedIndices: new Set(['0']) })
      const over = new WorldStateInjector({ tier3WholesaleWordBudget: 5, enableLLMSelection: true })

      const result = await over.buildContext(worldStateLarge, '', [])

      expect(runTier3Selection).toHaveBeenCalledTimes(1)
      expect(result.tier3.map((e) => e.name)).toEqual(['Borin'])
    })

    it('labels its debug entries distinctly from the lorebook selection', async () => {
      // Both selections used to log under one name, so the API Debug Logs could not tell
      // them apart -- and the view filters by that name, so neither could be read alone.
      runTier3Selection.mockResolvedValue({ selectedIndices: new Set() })
      const over = new WorldStateInjector({ tier3WholesaleWordBudget: 5, enableLLMSelection: true })

      await over.buildContext(worldStateLarge, '', [])

      expect(runTier3Selection.mock.calls[0][0].serviceLabel).toBe('tier3-world-state-selection')
    })

    it('drops the leftovers when there are too many and selection is off', async () => {
      // No third option: too much to include, and no permission to choose.
      const over = new WorldStateInjector({
        tier3WholesaleWordBudget: 5,
        enableLLMSelection: false,
      })

      const result = await over.buildContext(worldState, '', [])

      expect(result.tier3).toEqual([])
      expect(runTier3Selection).not.toHaveBeenCalled()
    })

    it('leaves Tier 3 empty when tiers 1 and 2 covered everything', async () => {
      const covered = { characters: [], locations: [], items: [], storyBeats: [] }
      const injector3 = new WorldStateInjector({
        tier3WholesaleWordBudget: 1000,
        enableLLMSelection: true,
      })

      const result = await injector3.buildContext(covered, '', [])

      expect(result.tier3).toEqual([])
      expect(runTier3Selection).not.toHaveBeenCalled()
    })
  })

  describe('caps', () => {
    /** `count` characters, all inactive so none reach Tier 1, all named in the input. */
    const named = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `n${i}`,
        name: `Npc${i}`,
        status: 'inactive',
        relationship: 'Stranger',
        description: 'Someone.',
      })) as Character[]

    const poolOf = (count: number) => ({
      characters: named(count),
      locations: [],
      items: [],
      storyBeats: [],
    })

    it('caps Tier 2 at its own slider, independently of Tier 3', async () => {
      const injector2 = new WorldStateInjector({ maxTier2Entries: 5, maxTier3Entries: 50 })
      const mentions = named(20)
        .map((c) => c.name)
        .join(' ')

      const result = await injector2.buildContext(poolOf(20), mentions, [])

      expect(result.tier2).toHaveLength(5)
    })

    it('does not cap the wholesale Tier 3 branch', async () => {
      // Below the threshold the leftover goes in as-is: "include what is left over" and
      // "the first N of it" cannot both be true.
      const injector2 = new WorldStateInjector({
        tier3WholesaleWordBudget: 1000,
        maxTier3Entries: 5,
        enableLLMSelection: true,
      })

      const result = await injector2.buildContext(poolOf(20), '', [])

      expect(result.tier3).toHaveLength(20)
    })

    it('never caps the sticky carry-over', async () => {
      // Only Tier 2/3 activations create stickiness, so the tier caps are already the
      // ceiling on what enters this set -- capping it again would drop context twice.
      const positions = new Map<string, number>()
      const tracker = {
        getLastActivation: (id: string) => positions.get(id) ?? null,
        recordActivation: (id: string, p: number) => positions.set(id, p),
        currentPosition: 0,
      }
      const pool = poolOf(20)
      const mentions = pool.characters.map((c) => c.name).join(' ')
      const injector2 = new WorldStateInjector({ maxTier2Entries: 40, maxTier3Entries: 50 })

      // Turn 1 activates all 20 through Tier 2; turn 2 mentions none of them.
      await injector2.buildContext(pool, mentions, [], { activationTracker: tracker })
      const result = await injector2.buildContext(pool, '', [], { activationTracker: tracker })

      expect(result.tier1.filter((e) => e.metadata?.sticky)).toHaveLength(20)
    })
  })

  describe('the protagonist', () => {
    const withPlayer = {
      ...worldState,
      characters: [
        ...characters,
        {
          id: 'me',
          name: 'Kestrel',
          status: 'active',
          relationship: 'self',
          description: 'Human, 28, tall',
          traits: ['stubborn'],
        } as Character,
      ],
    }

    it('is always in Tier 1, mentioned or not', async () => {
      const unmentioned = await injector.buildContext(withPlayer, 'nothing about anyone', [])
      expect(unmentioned.tier1.map((e) => e.name)).toContain('Kestrel')
    })

    it('gets a section of its own rather than being listed among the NPCs', async () => {
      // Observed on a real turn before this: the protagonist reached the prompt only when
      // their name happened to appear recently, and then under [KNOWN CHARACTERS].
      const result = await injector.buildContext(withPlayer, 'Kestrel, ready?', [])
      const block = result.contextBlock

      expect(block).toContain('[PROTAGONIST]')
      expect(block.indexOf('Kestrel')).toBeLessThan(block.indexOf('[KNOWN CHARACTERS]'))

      const known = block.slice(block.indexOf('[KNOWN CHARACTERS]'), block.indexOf('[INVENTORY]'))
      expect(known).not.toContain('Kestrel')
      expect(known).toContain('Aria')
    })

    it('carries traits and appearance, which image generation depends on', async () => {
      const result = await injector.buildContext(withPlayer, '', [])
      expect(result.contextBlock).toContain('stubborn')
    })

    it('cannot be re-selected into Tier 2 or Tier 3', async () => {
      const result = await injector.buildContext(withPlayer, 'Kestrel Kestrel Kestrel', [])

      expect(result.tier2.map((e) => e.name)).not.toContain('Kestrel')
      expect(result.tier3.map((e) => e.name)).not.toContain('Kestrel')
    })
  })

  describe('sticky entries are relevance, not state', () => {
    /** Left uncovered by tiers 1 and 2 in this fixture. */
    const uncoveredNames = ['Borin', 'Iron Mountain', 'Shield of Dawn']

    beforeEach(() => runTier3Selection.mockReset())

    /** Activate `names` on one turn, then run a turn mentioning nothing. */
    async function afterStickyTurn(state: typeof worldState, names: string) {
      const positions = new Map<string, number>()
      const tracker = {
        getLastActivation: (id: string) => positions.get(id) ?? null,
        recordActivation: (id: string, p: number) => positions.set(id, p),
        currentPosition: 0,
      }
      const local = new WorldStateInjector({
        enableLLMSelection: false,
        tier3WholesaleWordBudget: 0,
      })
      await local.buildContext(state, names, [], { activationTracker: tracker })
      return local.buildContext(state, '', [], { activationTracker: tracker })
    }

    it('never lists a sticky item as carried', async () => {
      // Shield of Dawn is on the ground. Sticky put it in Tier 1, and [INVENTORY] read
      // Tier 1 wholesale -- so the narrator was told the player carries it.
      const result = await afterStickyTurn(worldState, 'Shield of Dawn')

      expect(result.tier1.map((e) => e.name)).toContain('Shield of Dawn')
      const inventory = result.contextBlock.slice(
        result.contextBlock.indexOf('[INVENTORY]'),
        result.contextBlock.indexOf('[ACTIVE THREADS]'),
      )
      expect(inventory).toContain('Sunblade')
      expect(inventory).not.toContain('Shield of Dawn')
      expect(result.contextBlock).toContain('[RELEVANT ITEMS]')
    })

    it('renders a sticky location instead of dropping it', async () => {
      // Iron Mountain is neither the current location nor in Tier 2/3 once sticky, so it
      // used to be rendered nowhere -- while still being counted in `all`, and so
      // announced to the retrieval agent as already in a prompt it never reached.
      const result = await afterStickyTurn(worldState, 'Iron Mountain')

      expect(result.tier1.map((e) => e.name)).toContain('Iron Mountain')
      expect(result.contextBlock).toContain('[RELEVANT LOCATIONS]')
      expect(result.contextBlock).toContain('Iron Mountain')
    })

    it('keeps every entity in `all` renderable, so alreadyInContext cannot lie', async () => {
      const result = await afterStickyTurn(worldState, 'Iron Mountain Shield of Dawn Borin')

      for (const entity of result.all) {
        expect(result.contextBlock).toContain(entity.name)
      }
    })

    it('leaves genuinely current state in the state sections', async () => {
      const result = await afterStickyTurn(worldState, 'Iron Mountain')

      expect(result.contextBlock).toContain('[INVENTORY]\nSunblade')
      expect(result.contextBlock).toContain('[ACTIVE THREADS]')
      expect(result.contextBlock).toContain('Save the village')
    })

    // The helper above pins `tier3WholesaleWordBudget: 0`, so it can never reach the
    // wholesale branch — which is where the whole leftover lands on any story under the
    // budget, i.e. on most of them.
    it('does not make a wholesale Tier 3 sticky', async () => {
      // Wholesale means "the leftover was small", which says nothing about relevance.
      // Recording it would activate every uncovered entity on every turn, so Tier 1 would
      // swallow the pool and stickiness would never expire. `EntryRetrievalService` has
      // always excluded it; this side used to say it mirrored that, and did not.
      const positions = new Map<string, number>()
      const tracker = {
        getLastActivation: (id: string) => positions.get(id) ?? null,
        recordActivation: (id: string, p: number) => positions.set(id, p),
        currentPosition: 4,
      }
      const generous = new WorldStateInjector({
        tier3WholesaleWordBudget: 1000,
        enableLLMSelection: true,
      })

      const first = await generous.buildContext(worldState, '', [], {
        activationTracker: tracker,
      })

      expect(first.tier3.map((e) => e.name).sort()).toEqual([...uncoveredNames].sort())
      expect(runTier3Selection).not.toHaveBeenCalled()
      for (const entry of first.tier3) {
        expect(positions.has(entry.id)).toBe(false)
      }

      // And so nothing carries into the next turn as Tier 1 sticky.
      const next = await generous.buildContext(worldState, '', [], { activationTracker: tracker })
      expect(next.tier1.filter((e) => e.metadata?.sticky)).toHaveLength(0)
    })

    // The wholesale branch is the only place the Tier 2 list is used on its own, so a
    // regression that recorded *nothing* there would satisfy the test above and go unseen.
    it('still records Tier 2 in the wholesale branch', async () => {
      const positions = new Map<string, number>()
      const tracker = {
        getLastActivation: (id: string) => positions.get(id) ?? null,
        recordActivation: (id: string, p: number) => positions.set(id, p),
        currentPosition: 4,
      }
      const generous = new WorldStateInjector({
        tier3WholesaleWordBudget: 1000,
        enableLLMSelection: true,
      })

      // Naming Borin pulls him into Tier 2; the rest of the leftover goes in wholesale.
      const result = await generous.buildContext(worldState, 'Borin, are you ready?', [], {
        activationTracker: tracker,
      })

      expect(result.tier2.map((e) => e.name)).toContain('Borin')
      expect(result.tier3.length).toBeGreaterThan(0)
      for (const entry of result.tier2) {
        expect(positions.get(entry.id)).toBe(4)
      }
      for (const entry of result.tier3) {
        expect(positions.has(entry.id)).toBe(false)
      }
    })

    it('still makes an LLM-selected Tier 3 sticky', async () => {
      // The other half of the rule: a model was paid to call this relevant, and stickiness
      // is what makes relevance outlive the turn that noticed it.
      const positions = new Map<string, number>()
      const tracker = {
        getLastActivation: (id: string) => positions.get(id) ?? null,
        recordActivation: (id: string, p: number) => positions.set(id, p),
        currentPosition: 4,
      }
      runTier3Selection.mockResolvedValue({ selectedIndices: new Set(['0']) })
      const tight = new WorldStateInjector({
        tier3WholesaleWordBudget: 0,
        enableLLMSelection: true,
      })

      const result = await tight.buildContext(worldState, '', [], { activationTracker: tracker })

      expect(result.tier3).toHaveLength(1)
      expect(positions.get(result.tier3[0].id)).toBe(4)
    })
  })
})
