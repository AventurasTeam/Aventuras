import { describe, expect, it } from 'vitest'

import type { Entity } from '@/lib/db'
import { makeEntity } from '@/lib/list-modules/__tests__/fixtures'
import { buildEntityViews, emptyEntityView } from '@/lib/world'

import { renderTemplate, TEMPLATE_IDS } from '../index'
import { PIGGYBACK_FALLBACK_CLASSIFIER } from './piggyback-fallback-classifier'
import { STATE_EMISSION } from './state-emission'

const renderHalves = (context: Record<string, unknown>) =>
  renderTemplate(TEMPLATE_IDS.piggybackFallbackClassifier, context)
const render = (context: Record<string, unknown>) => renderHalves(context).user

// Anchored on the fixed opening/closing tokens so the mid-section — the two branches'
// inner phrasing — is whatever the source under test actually says, not assumed.
const WORLD_TIME_DELTA_CLAUSE =
  /\{% if worldTimeDeltaBasis == 'sinceUserAction' %\}[\s\S]*?\{% endif %\} \(0 for a flashback or memory; never negative\)/

function worldTimeDeltaClause(source: string): string {
  const match = source.match(WORLD_TIME_DELTA_CLAUSE)
  if (!match) throw new Error('world-time-delta clause not found in template source')
  return match[0]
}

// piggyback.md → Creating a place or an item, verbatim: the significance rules both writers apply.
const PLACE_RULE =
  "Create a place only when the scene settles somewhere with its own identity the story could come back to: a named place, a building, a room that matters, a stretch of wild land where things happen. Don't create one for passing through (a corridor, a doorway, the road between two places); keep the current location then. Use an existing place's ID whenever the scene is somewhere already in Places, and nest a new place under the place it's part of."
const ITEM_RULE =
  'Create an item only when a character takes, receives or is given something that matters beyond this moment: a weapon, a key, a letter, a relic. Not food eaten on the spot, not money (use a stackable), not scenery.'

const KAEL = makeEntity({
  id: 'c1',
  kind: 'character',
  name: 'Kael',
  description: 'A courier with a stolen sigil.',
  state: { inventory: ['i3'], equipped_items: ['i4'] } as never,
})
const KEEP = makeEntity({
  id: 'l1',
  kind: 'location',
  name: 'The Drowned Keep',
  description: 'Half sunk into the marsh.',
})
const item = (id: string, name: string, over: Partial<Entity> = {}, at: string | null = null) =>
  makeEntity({ id, kind: 'item', name, state: { at_location_id: at }, ...over })
const SEAL = item('i3', 'Courier’s seal', { description: 'Black wax, cracked.' })
const SWORD = item('i4', 'short sword')
const LANTERN = item('i5', 'a rusted lantern', {}, 'l1')
const VEILSTONE = item('i9', 'Veilstone', { description: '', status: 'staged' })
const BEX = makeEntity({ id: 'c2', kind: 'character', name: 'Bex', description: 'A quiet smith.' })
const WORLD = [KAEL, KEEP, VEILSTONE, SEAL, SWORD, LANTERN]

// The rows generation-context hands over: each projected with its view over this scene.
const project = (rows: Entity[], sceneEntities: string[]) => {
  const views = buildEntityViews(rows, { sceneEntities, currentLocationId: 'l1' })
  return rows.map((e) => ({
    id: e.id,
    kind: e.kind,
    name: e.name,
    description: e.description,
    status: e.status,
    injectionMode: e.injectionMode,
    state: views.byId.get(e.id),
  }))
}

/**
 * Every bucket buildGenerationContext emits, kept non-empty — an omitted one would make a
 * `nil.size > 0` assertion pass for the wrong reason.
 */
const context = (over: Record<string, unknown> = {}, rows: Entity[] = WORLD) => {
  const sceneEntities = (over.sceneEntities as string[] | undefined) ?? ['c1', 'l1']
  const projected = project(rows, sceneEntities)
  return {
    definition: {
      mode: 'adventure',
      genre: { label: 'Fantasy', promptBody: '' },
      tone: { label: 'Wry', promptBody: '' },
      setting: '',
    },
    entities: projected,
    sceneEntities,
    structuralLocation: projected.find((e) => e.id === 'l1'),
    lastTurns: [
      { position: 1, content: 'The marsh road ended at a wall of black water.' },
      { position: 2, content: 'Kael went first, testing the stones.' },
      { position: 3, content: 'I put the sword away and raised both hands.' },
      { position: 4, content: 'The keep answered with a single lantern, swinging.' },
    ],
    calendarVocabulary: {
      baseUnitName: 'day',
      secondsPerBaseUnit: 86400,
      tiers: [{ name: 'month', labels: ['Frostmoon', 'Thawmoon'] }],
    },
    locationIds: [],
    locationMap: [
      { id: 'l2', name: 'The Marsh', depth: 0 },
      { id: 'l1', name: 'The Drowned Keep', depth: 1 },
    ],
    currentLocationChain: ['The Marsh'],
    heldItems: [],
    looseItems: projected.filter((e) => e.id === 'i5'),
    structuralActiveThreads: [
      { id: 't1', status: 'active', title: 'Find the heir', description: 'Still open.' },
    ],
    structuralPinnedEntities: [],
    structuralSceneFactions: [],
    structuralPinnedLore: [{ id: 'lore_1', title: 'House Eldrin', body: 'An exiled line.' }],
    structuralPinnedThreads: [],
    retrievedEntities: [
      {
        id: 'c7',
        displayName: 'Mora',
        renderedText: 'never rendered',
        kind: 'character',
        name: 'Mora',
        description: 'last seen at the ford.',
        status: 'active',
        state: emptyEntityView('character'),
      },
    ],
    retrievedLore: [],
    retrievedHappenings: [
      { id: 'h1', displayName: 'The siege', renderedText: 'The siege broke on the third night.' },
    ],
    retrievedThreads: [],
    retrievedChapters: [
      { id: 'ch1', displayName: 'Chapter One', renderedText: 'Chapter One: the marsh road.' },
    ],
    namedCharacters: [
      {
        id: 'c8',
        kind: 'character',
        name: 'Ilse',
        description: 'A ferrywoman.',
        status: 'staged',
        injectionMode: 'auto',
        state: { ...emptyEntityView('character'), voice: 'soft' },
      },
    ],
    piggybackFires: false,
    suggestionsFire: false,
    worldTimeDeltaBasis: 'sinceLastAiReply',
    ...over,
  }
}

describe('bundled piggyback fallback classifier template', () => {
  /**
   * Trimming vs. non-trimming delimiters here are intentional, not inconsistent — normalising
   * them welds a heading onto the prose above it, and `toContain` can't catch that
   * (`turn.# In scene` still contains `# In scene`). Only the snapshot below sees it.
   */
  it('matches the recorded snapshot', () => {
    expect(renderHalves(context())).toMatchSnapshot()
  })

  // piggyback.md → Fallback classifier context: Setting/Genre/Tone bias extraction toward
  // narrating, so neither renders here — this call carries its own structured-output schema.
  it('never renders Setting, Genre, Tone or an output-format macro', () => {
    const { system, user } = renderHalves(
      context({
        definition: {
          mode: 'adventure',
          setting: 'SETTING-MARKER a keep on a hill',
          genre: { label: 'Fantasy', promptBody: 'GENRE-MARKER high fantasy' },
          tone: { label: 'Wry', promptBody: 'TONE-MARKER dry and clipped' },
        },
      }),
    )

    for (const half of [system, user]) {
      expect(half).not.toContain('SETTING-MARKER')
      expect(half).not.toContain('GENRE-MARKER')
      expect(half).not.toContain('TONE-MARKER')
      expect(half).not.toContain('# Setting')
      expect(half).not.toContain('# Genre')
      expect(half).not.toContain('# Tone')
      expect(half).not.toContain('Write the next beat of the story as prose')
      expect(half).not.toContain('<state>')
    }
  })

  // piggybackFires false → macro_memory_blocks brackets no ids (roster is the sole ID source);
  // true would also inject per-turn.ts's tagged-block lines for an emission this never makes.
  // piggyback.md → Fallback classifier context: the roster is where ids come from, and a row
  // showing state without one leaves the model matching it to the roster by name.
  it("brackets the memory blocks' entity ids, without the tagged-block instructions", () => {
    const prompt = render(context())

    expect(prompt).toContain('# Elsewhere in the world')
    // The whole line, not a substring: it has to lead with the id.
    expect(prompt.split('\n').find((l) => l.includes('Mora'))).toBe(
      '[c7] Mora (currently elsewhere): last seen at the ford.',
    )
    expect(prompt).not.toContain('include their ID (without brackets) in the trailing')
    expect(prompt).not.toContain('Use an ID from Places')
  })

  // piggyback.md → Fallback classifier context.
  describe('system and user halves', () => {
    it('is the calendar block alone in the system half', () => {
      expect(renderHalves(context()).system).toBe(
        '# Calendar\nThis story tracks time in days (86400 seconds per day). Tiers: month (Frostmoon and Thawmoon). Convert relative-time prose ("two days later", "the next morning") into a seconds delta using these units.',
      )
    })

    it('renders a blank system half when the story has no calendar', () => {
      const { system, user } = renderHalves(context({ calendarVocabulary: null }))
      expect(system).toBe('')
      expect(user).toContain('\n# This turn\n')
    })

    it('keeps the calendar out of the user half', () => {
      const user = render(context())
      expect(user).not.toContain('# Calendar')
      expect(user).not.toContain('This story tracks time')
    })

    it("keeps the user half's headings in the order the template had them", () => {
      const user = render(context())
      expect(user.split('\n').filter((line) => line.startsWith('# '))).toEqual([
        '# In scene',
        '# Current location',
        '# Places',
        '# Elsewhere in the world',
        '# Relevant lore',
        '# What has happened',
        '# Active threads',
        '# Earlier chapters',
        '# Named in this turn — not necessarily present',
        '# Earlier turns — how the scene got here, not the turn you report on',
        '# This turn',
      ])
    })
  })

  // The roster opens the user half, ahead of every memory block.
  it('keeps its first line', () => {
    expect(render(context()).split('\n')[0]).toBe(
      'Known entities, referenced only by the ID shown below in brackets — write it without the brackets, never invent one:',
    )
  })

  // piggyback.md → Fallback classifier context: bracketed IDs, the roster being its only source.
  describe('the location map and item lines', () => {
    it('renders the map nested, with IDs', () => {
      expect(render(context())).toContain('# Places\n[l2] The Marsh\n  [l1] The Drowned Keep\n')
    })

    it('renders a retired place without an id, with its reason or none', () => {
      const locationMap = [
        { retired: false, id: 'l2', name: 'The Marsh', depth: 0, retiredReason: null },
        {
          retired: true,
          id: null,
          name: 'Saltmere',
          depth: 1,
          retiredReason: 'swallowed by the rift',
        },
        { retired: true, id: null, name: 'the Drowned Chapel', depth: 2, retiredReason: null },
      ]
      expect(render(context({ locationMap }))).toContain(
        '# Places\n[l2] The Marsh\n  Saltmere (retired: swallowed by the rift)\n    the Drowned Chapel (retired)\n',
      )
    })

    it('renders the current location with its chain and the items lying there, with IDs', () => {
      expect(render(context())).toContain(
        '[l1] The Drowned Keep — in The Marsh: Half sunk into the marsh.\nHere:\n- [i5] a rusted lantern\n',
      )
    })

    it('lists what an in-scene character holds, and does not repeat a held item in the scene list', () => {
      const prompt = render(context({ sceneEntities: ['c1', 'i3'] }))

      expect(prompt).toContain(
        '## Kael [c1]\nA courier with a stolen sigil.\nHolds:\n- [i3] Courier’s seal: Black wax, cracked.\n- [i4] short sword (equipped)\n',
      )
      expect(prompt).not.toContain('## Courier’s seal')
      expect(prompt.split('Black wax, cracked.')).toHaveLength(2)
    })

    it('does not repeat an item held by any in-scene character, not only the last holder', () => {
      const bex = makeEntity({ ...BEX, state: { inventory: ['i6'], equipped_items: [] } as never })
      const kael = makeEntity({
        ...KAEL,
        state: { inventory: ['i3'], equipped_items: [] } as never,
      })
      const prompt = render(
        context({ sceneEntities: ['c1', 'c2', 'i3'] }, [
          kael,
          KEEP,
          bex,
          SEAL,
          item('i6', 'hammer'),
        ]),
      )

      expect(prompt).not.toContain('## Courier’s seal')
      expect(prompt).toContain(
        '## Kael [c1]\nA courier with a stolen sigil.\nHolds:\n- [i3] Courier’s seal: Black wax, cracked.\n',
      )
      expect(prompt).toContain('## Bex [c2]\nA quiet smith.\nHolds:\n- [i6] hammer\n')
    })

    it('gives a Holds block only to the character that holds the items', () => {
      const prompt = render(context({ sceneEntities: ['c1', 'c2'] }, [...WORLD, BEX]))

      expect(prompt.split('Holds:')).toHaveLength(2)
      expect(prompt).toContain('## Bex [c2]\nA quiet smith.\n\n')
    })

    it('omits the map, the chain and the item lines when there are none', () => {
      const prompt = render(
        context({ locationMap: [], currentLocationChain: [], looseItems: [] }, [
          makeEntity({ ...KAEL, state: null }),
          KEEP,
        ]),
      )

      expect(prompt).not.toContain('# Places')
      expect(prompt).not.toContain(' — in ')
      expect(prompt).not.toContain('Holds:')
      expect(prompt).not.toContain('Here:')
      expect(prompt).toContain('The Drowned Keep: Half sunk into the marsh.')
    })
  })

  // piggyback.md → Fallback classifier context: a character the turn names, whom nothing else
  // shows with state, still carries the values a write replaces, beside its id.
  describe('characters named in this turn', () => {
    it('renders each with its id, head and state lines, in the baseline region', () => {
      const prompt = render(context())
      expect(prompt).toContain(
        '# Named in this turn — not necessarily present\n\n[c8] Ilse: A ferrywoman.\nVoice: soft\n',
      )
      expect(prompt.indexOf('# Named in this turn')).toBeLessThan(prompt.indexOf('\n# This turn\n'))
    })

    it('leaves the block out when there are none', () => {
      expect(render(context({ namedCharacters: [] }))).not.toContain('# Named in this turn')
    })
  })

  describe('creates', () => {
    it('asks for newLocations and newItems, with new: handles, after the turn it reports on', () => {
      const prompt = render(context())

      expect(prompt).toContain('in newLocations')
      expect(prompt).toContain('in newItems')
      expect(prompt).toContain('a handle that starts with new:')
      expect(prompt).toContain(
        "a new item as a transfer's item id or, when it is in the scene, in sceneEntities.",
      )
      expect(prompt.indexOf('in newLocations')).toBeGreaterThan(prompt.indexOf('\n# This turn\n'))
    })

    // One contract across both writers (piggyback.md → Fallback classifier context): same rules.
    it.each([
      ['the fallback prompt', () => render(context())],
      ['the tagged-block macro', () => STATE_EMISSION],
    ])('carries the significance rules verbatim in %s', (_, source) => {
      expect(source()).toContain(PLACE_RULE)
      expect(source()).toContain(ITEM_RULE)
    })
  })

  // Builder half (a real resolveWorldTimeDeltaBasis call over a seeded turn pair) is
  // per-turn-piggyback.test.ts; this file only proves the template renders the variable.
  describe('world time delta basis', () => {
    it.each([
      ['sinceUserAction', "since the end of the user's action"],
      ['sinceLastAiReply', 'since the previous entry'],
    ])('states the %s basis in the prompt', (basis, phrase) => {
      const prompt = render(context({ worldTimeDeltaBasis: basis }))

      expect(prompt).toContain(phrase)
      expect(prompt).toContain('never negative')
    })

    // Hand-verified against state-emission.ts across three reviews; enforce it instead.
    it('matches state-emission.ts word for word on the world-time-delta clause', () => {
      expect(worldTimeDeltaClause(PIGGYBACK_FALLBACK_CLASSIFIER.user)).toBe(
        worldTimeDeltaClause(STATE_EMISSION),
      )
    })
  })

  describe('extraction-turn marking (mandatory, not stylistic)', () => {
    // Newline-anchored: the background sentence quotes "# This turn" by name, so a
    // bare indexOf would find the pointer to the header rather than the header.
    const headingAt = (prompt: string, heading: string) => prompt.indexOf(`\n${heading}\n`)

    // The memory blocks are the hazard the marking exists for — older and bulkier than
    // any tail of entries, and arriving with no framing of their own.
    it('marks the reference sections as background', () => {
      const prompt = render(context())

      const backgroundAt = prompt.indexOf('the world as it stands going into that turn')
      const loreAt = prompt.indexOf('# Relevant lore')
      expect(backgroundAt).toBeGreaterThan(-1)
      expect(loreAt).toBeGreaterThan(backgroundAt)
    })

    it('marks entries above the pair as background and the pair as this turn', () => {
      const prompt = render(
        context({
          lastTurns: [
            { content: 'e1 oldest' },
            { content: 'e2 older' },
            { content: 'e3 the action' },
            { content: 'e4 the reply' },
          ],
        }),
      )

      const earlierAt = prompt.indexOf('\n# Earlier turns')
      const thisTurnAt = headingAt(prompt, '# This turn')
      expect(earlierAt).toBeGreaterThan(-1)
      expect(prompt.indexOf('e1 oldest')).toBeGreaterThan(earlierAt)
      expect(prompt.indexOf('e2 older')).toBeGreaterThan(earlierAt)
      expect(prompt.indexOf('e2 older')).toBeLessThan(thisTurnAt)
      expect(prompt.indexOf('e3 the action')).toBeGreaterThan(thisTurnAt)
      expect(prompt.indexOf('e4 the reply')).toBeGreaterThan(thisTurnAt)
    })

    // The pair is the evidence window — the user's action can carry the state change
    // ("I put the sword away") — so it is never marked background, target or not.
    it('omits the earlier-turns header when only the pair is present', () => {
      const prompt = render(
        context({ lastTurns: [{ content: 'e1 the action' }, { content: 'e2 the reply' }] }),
      )

      expect(prompt).not.toContain('# Earlier turns')
      expect(headingAt(prompt, '# This turn')).toBeGreaterThan(-1)
      expect(prompt).toContain('e1 the action')
      expect(prompt).toContain('e2 the reply')
    })

    it('still marks this turn when the branch holds a single entry', () => {
      const prompt = render(context({ lastTurns: [{ content: 'e1 only' }] }))

      expect(prompt).not.toContain('# Earlier turns')
      expect(headingAt(prompt, '# This turn')).toBeGreaterThan(-1)
      expect(prompt).toContain('e1 only')
    })
  })
})
