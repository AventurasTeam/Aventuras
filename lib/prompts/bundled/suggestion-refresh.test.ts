import { describe, expect, it } from 'vitest'

import type { Entity } from '@/lib/db'
import { makeEntity } from '@/lib/list-modules/__tests__/fixtures'
import { buildEntityViews } from '@/lib/world'

import { renderTemplate, TEMPLATE_IDS } from '../index'

type Definition = { setting: string; genre: string; tone: string }

const FULL: Definition = {
  setting: 'A keep on a hill.',
  genre: 'High fantasy.',
  tone: 'Dry humor.',
}

const render = ({ setting, genre, tone }: Definition) =>
  renderTemplate(TEMPLATE_IDS.suggestionRefresh, {
    definition: {
      mode: 'adventure',
      setting,
      genre: { promptBody: genre },
      tone: { promptBody: tone },
    },
    entities: [
      {
        id: 'char_1',
        kind: 'character',
        name: 'Aria',
        description: 'A wary scout.',
        status: 'active',
        injectionMode: 'auto',
      },
    ],
    sceneEntities: ['char_1'],
    entries: [{ content: 'The gate groaned open.' }],
    suggestionCount: 2,
    suggestionSlots: [{ ref: 'cat1', label: 'Action', promptHint: 'A decisive move.' }],
    refreshGuidance: 'Sneak around the back.',
  })

// architecture.md → System and user halves.
describe('bundled suggestion-refresh template — system and user halves', () => {
  it('holds Setting, Genre and Tone in the system half, in that order, and nothing after them', () => {
    expect(render(FULL).system).toBe(
      '# Setting\nA keep on a hill.\n\n# Genre\nHigh fantasy.\n\n# Tone\nDry humor.',
    )
  })

  // Each block carries its own trailing blank line; whichever is last, the half must not end on it.
  it.each([
    {
      name: 'no genre',
      definition: { ...FULL, genre: '' },
      system: '# Setting\nA keep on a hill.\n\n# Tone\nDry humor.',
    },
    {
      name: 'no tone',
      definition: { ...FULL, tone: '' },
      system: '# Setting\nA keep on a hill.\n\n# Genre\nHigh fantasy.',
    },
    {
      name: 'genre only',
      definition: { setting: '', genre: 'High fantasy.', tone: '' },
      system: '# Genre\nHigh fantasy.',
    },
    {
      name: 'setting only',
      definition: { setting: 'A keep on a hill.', genre: '', tone: '' },
      system: '# Setting\nA keep on a hill.',
    },
  ])('joins the blocks that are set with one blank line ($name)', ({ definition, system }) => {
    expect(render(definition).system).toBe(system)
  })

  it('renders a blank system half when the definition sets no setting, genre or tone', () => {
    const { system, user } = render({ setting: '', genre: '', tone: '' })
    expect(system).toBe('')
    expect(user).toContain('# Story so far')
  })

  it('carries the scene, the story, the options and the draft in the user half', () => {
    const { user } = render(FULL)
    expect(user.split('\n').filter((line) => line.startsWith('# '))).toEqual([
      '# In scene',
      '# Story so far',
      '# Next-turn options',
    ])
    expect(user).toContain(
      'The reader has already started writing their next turn:\n\nSneak around the back.',
    )
    for (const definitionText of [
      '# Setting',
      '# Genre',
      '# Tone',
      'A keep on a hill.',
      'High fantasy.',
      'Dry humor.',
    ]) {
      expect(user).not.toContain(definitionText)
    }
  })
})

// reader-composer.md → Next-turn suggestions: a chip is written as the user's next turn.
describe("bundled suggestion-refresh template — the chips' voice", () => {
  const KAEL = { id: 'c1', name: 'Kael' }
  const optionsFor = (mode: string, composerWrapPov: string, lead: typeof KAEL | null) => {
    const { user } = renderTemplate(TEMPLATE_IDS.suggestionRefresh, {
      definition: { mode, narration: 'second', setting: '', genre: {}, tone: {} },
      composerWrapPov,
      lead,
      entities: [],
      sceneEntities: [],
      entries: [],
      suggestionCount: 2,
      suggestionSlots: [{ ref: 'cat1', label: 'Action', promptHint: 'A move.' }],
    })
    return user.slice(user.indexOf('# Next-turn options'))
  }

  it("writes an adventure chip as the lead's next turn, never the world's response", () => {
    const options = optionsFor('adventure', 'first', KAEL)
    expect(options).toContain(
      "Write each option as Kael's next turn: what Kael does, says or attempts next, never how the world or anyone else responds.",
    )
    expect(options).toContain('Draw only on what Kael knows.')
  })

  it('writes it in the wrap person', () => {
    expect(optionsFor('adventure', 'first', KAEL)).toContain(
      'Write it in the first person, as "I".',
    )
    expect(optionsFor('adventure', 'third', KAEL)).toContain(
      'Write it in the third person, calling Kael by name.',
    )
  })

  it('falls back to the first person with no lead, which needs no name', () => {
    const options = optionsFor('adventure', 'third', null)
    expect(options).toContain('Write it in the first person, as "I".')
    expect(options).not.toContain('third person')
    expect(options).not.toContain('undefined')
  })

  it('writes a creative chip as a short direction in the third person, by name', () => {
    for (const person of ['first', 'third']) {
      const options = optionsFor('creative', person, KAEL)
      expect(options).toContain(
        "Write each option as a short direction for the story's next beat, in the third person, calling characters by name",
      )
      expect(options).toContain('It may involve any character.')
      expect(options).not.toContain('as "I"')
    }
  })
})

describe('bundled suggestion-refresh template — the story so far', () => {
  it("wraps the user's turns in <user_turn>, leaving the opening and replies bare", () => {
    const { user } = renderTemplate(TEMPLATE_IDS.suggestionRefresh, {
      definition: { mode: 'creative', setting: '', genre: {}, tone: {} },
      entities: [],
      sceneEntities: [],
      entries: [
        { kind: 'opening', content: 'The gate groaned open.' },
        { kind: 'user_action', content: 'I step through.\n\nThen I wait.' },
        { kind: 'ai_reply', content: 'Nothing stirs.' },
      ],
      suggestionCount: 1,
      suggestionSlots: [{ ref: 'cat1', label: 'Action', promptHint: 'A move.' }],
    })
    expect(user).toContain(
      '# Story so far\n\nThe gate groaned open.\n\n<user_turn>\nI step through.\n\nThen I wait.\n</user_turn>\n\nNothing stirs.\n',
    )
  })
})

// architecture.md → Entity state on the template surface: the narrator's in-scene list, no ids.
describe('bundled suggestion-refresh template — in scene', () => {
  const sceneOf = (rows: Entity[], sceneEntities: string[]) => {
    const views = buildEntityViews(rows, { sceneEntities, currentLocationId: null })
    return renderTemplate(TEMPLATE_IDS.suggestionRefresh, {
      definition: {
        mode: 'adventure',
        setting: '',
        genre: { promptBody: '' },
        tone: { promptBody: '' },
      },
      entities: rows.map((e) => ({ ...e, state: views.byId.get(e.id) })),
      sceneEntities,
      entries: [{ content: 'The gate groaned open.' }],
      suggestionCount: 2,
      suggestionSlots: [{ ref: 'cat1', label: 'Action', promptHint: 'A decisive move.' }],
      refreshGuidance: '',
    }).user
  }
  const aria = makeEntity({
    id: 'char_1',
    kind: 'character',
    name: 'Aria',
    description: 'A wary scout.',
    state: {
      inventory: ['item_k'],
      equipped_items: [],
      voice: 'low',
      stackables: { gold: 3 },
    } as never,
  })
  const key = makeEntity({
    id: 'item_k',
    kind: 'item',
    name: 'Silver Key',
    description: 'Cold to the touch.',
    state: { at_location_id: null },
  })

  it('renders each in-scene entity with its state lines and held items, without ids', () => {
    const user = sceneOf([aria, key], ['char_1', 'item_k'])
    expect(user).toContain(
      '# In scene\n\n## Aria\nA wary scout.\nVoice: low\nHolds:\n- Silver Key: Cold to the touch.\nStackables: gold 3\n\n# Story so far',
    )
    expect(user).not.toContain('[')
    // Held, so listed under its holder alone.
    expect(user).not.toContain('## Silver Key')
  })

  // In scene, an item is where the scene is, whoever off-scene holds it.
  it('renders an in-scene item held off-scene with no Location or Held by line', () => {
    const rows = [
      makeEntity({ ...aria, state: null }),
      makeEntity({
        id: 'char_2',
        kind: 'character',
        name: 'Bex',
        state: { inventory: ['item_l'], equipped_items: [] } as never,
      }),
      makeEntity({
        id: 'item_l',
        kind: 'item',
        name: 'Lantern',
        description: 'Still lit.',
        state: { at_location_id: 'loc_2' },
      }),
      makeEntity({ id: 'loc_2', kind: 'location', name: 'The Mill' }),
    ]
    const views = buildEntityViews(rows, {
      sceneEntities: ['char_1', 'item_l'],
      currentLocationId: null,
    })
    expect(views.byId.get('item_l')).toMatchObject({
      holder: { name: 'Bex' },
      location: { name: 'The Mill' },
    })

    const user = sceneOf(rows, ['char_1', 'item_l'])
    expect(user).toContain('## Lantern\nStill lit.\n\n# Story so far')
    expect(user).not.toContain('Held by:')
    expect(user).not.toContain('Location:')
  })

  it('prints no empty line under an entity with no description', () => {
    const user = sceneOf([makeEntity({ ...aria, description: null, state: null })], ['char_1'])
    expect(user).toContain('# In scene\n\n## Aria\n\n# Story so far')
  })
})
