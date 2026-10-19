import { describe, expect, it } from 'vitest'

import type { Entity } from '@/lib/db'
import { makeEntity } from '@/lib/list-modules/__tests__/fixtures'
import {
  countTokens,
  entityFraming,
  entityRenderedText,
  HELD_ITEM_ID_STAND_IN,
  measuredEntity,
  RANKER_DEFAULTS,
  type MeasuredEntity,
  type RetrievalType,
} from '@/lib/retrieval'
import { buildEntityViews, emptyEntityView, type ViewScene } from '@/lib/world'

import { createEngine } from '../engine'
import { MACRO_IDS } from '../ids'
import type { Pack } from '../types'
import { bundledPack } from './index'

// Rendered by its own id, not through a template: an all-empty context renders
// the macro blank, which renderWith refuses as a template's user half. Every
// bundled macro is loaded, since the entity rows include the entity-state ones.
function renderMacro(context: Record<string, unknown>): string {
  const pack: Pack = { templates: {}, macros: bundledPack.macros }
  return createEngine(pack).renderFileSync(MACRO_IDS.memoryBlocks, context) as string
}

// Every bucket the macro reads, all empty. Spread-and-override so each test
// populates exactly one and the rest stay provably absent.
const EMPTY = {
  structuralPinnedEntities: [],
  structuralSceneFactions: [],
  structuralPinnedLore: [],
  structuralPinnedThreads: [],
  structuralActiveThreads: [],
  retrievedEntities: [],
  retrievedLore: [],
  retrievedHappenings: [],
  retrievedThreads: [],
  retrievedChapters: [],
  ids: true,
}

const ranked = (id: string, displayName: string, renderedText: string) => ({
  id,
  displayName,
  renderedText,
})

// An entity row as generation-context hands it over: id, the data, and its view.
const entityRowOf = (id: string, entity: MeasuredEntity, ranking = false) => ({
  id,
  ...(ranking ? { displayName: entity.name, renderedText: 'never rendered' } : {}),
  ...entity,
})

const plain = (over: Partial<Omit<MeasuredEntity, 'kind' | 'state'>> = {}): MeasuredEntity => ({
  kind: 'character',
  name: 'Mira',
  description: 'A courier.',
  status: 'active',
  state: emptyEntityView('character'),
  ...over,
})

const floorEntity = entityRowOf(
  'char_9',
  plain({ name: 'Old Sesk', description: 'A ferryman long dead.', status: 'retired' }),
)
const rankedMira = entityRowOf('char_2', plain(), true)
const floorLore = { id: 'lore_9', title: 'The Concord', body: 'Signed at the river.' }
const floorThread = { id: 'thr_9', status: 'pending', title: 'The debt', description: 'Unpaid.' }

describe('memory-blocks macro — empty-guard contract', () => {
  it('renders nothing at all when every bucket is empty', () => {
    expect(renderMacro(EMPTY).trim()).toBe('')
    // Positive control: the same helper does produce a block when one bucket
    // is populated, so the assertion above is not passing on a dead render.
    expect(
      renderMacro({ ...EMPTY, retrievedLore: [ranked('lore_1', 'Veilstone', 'x')] }),
    ).toContain('# Relevant lore')
  })

  const blocks: [header: string, key: string, row: unknown][] = [
    ['# Elsewhere in the world', 'structuralPinnedEntities', floorEntity],
    ['# Elsewhere in the world', 'structuralSceneFactions', floorEntity],
    ['# Elsewhere in the world', 'retrievedEntities', rankedMira],
    ['# Relevant lore', 'structuralPinnedLore', floorLore],
    ['# Relevant lore', 'retrievedLore', ranked('lore_1', 'Veilstone', 'Veilstone\nA shard.')],
    [
      '# What has happened',
      'retrievedHappenings',
      ranked('hap_1', 'The bridge fell', 'The bridge fell\nAt dawn.'),
    ],
    ['# Active threads', 'structuralActiveThreads', { ...floorThread, status: 'active' }],
    ['# Background threads', 'structuralPinnedThreads', floorThread],
    ['# Background threads', 'retrievedThreads', ranked('thr_1', 'The debt', 'The debt\nUnpaid.')],
    [
      '# Earlier chapters',
      'retrievedChapters',
      ranked('chap_1', 'The Long Road', 'She left the capital.\nDeparture.'),
    ],
  ]

  it.each(blocks)('emits %s only when %s is populated', (header, key, row) => {
    expect(renderMacro({ ...EMPTY, [key]: [row] })).toContain(header)
    expect(renderMacro(EMPTY)).not.toContain(header)
  })
})

describe('memory-blocks macro — row content', () => {
  it('brackets entity ids only on `ids`, and never on the other types', () => {
    const context = {
      ...EMPTY,
      structuralPinnedEntities: [floorEntity],
      retrievedEntities: [rankedMira],
      retrievedLore: [ranked('lore_1', 'Veilstone', 'Veilstone\nA shard.')],
      retrievedHappenings: [ranked('hap_1', 'Fall', 'Fall\nAt dawn.')],
      retrievedThreads: [ranked('thr_1', 'Debt', 'Debt\nUnpaid.')],
      retrievedChapters: [ranked('chap_1', 'Road', 'She left.\nDeparture.')],
    }
    const firing = renderMacro(context)
    expect(firing).toContain('[char_2] Mira')
    expect(firing).toContain('[char_9] Old Sesk')
    for (const id of ['lore_1', 'hap_1', 'thr_1', 'chap_1']) expect(firing).not.toContain(id)

    const quiet = renderMacro({ ...context, ids: false })
    expect(quiet).not.toContain('[char_2]')
    expect(quiet).not.toContain('[char_9]')
    // Positive control: the rows themselves still render, only the ids drop.
    expect(quiet).toContain('Mira (not in the scene): A courier.')
    expect(quiet).toContain('Old Sesk')
  })

  it('carries no emission instructions — those belong to the including template', () => {
    const out = renderMacro({
      ...EMPTY,
      structuralPinnedEntities: [floorEntity],
      retrievedEntities: [rankedMira],
    })
    expect(out).not.toContain('<scene_entities>')
    expect(out).not.toContain('<current_location>')
    // Positive control: the rows the instructions would have referred to render.
    expect(out).toContain('[char_2] Mira (not in the scene): A courier.')
  })

  it('renders happening awareness sources verbatim, newlines and all', () => {
    const out = renderMacro({
      ...EMPTY,
      retrievedHappenings: [
        ranked(
          'hap_1',
          'The bridge fell',
          'The bridge fell\nAt dawn.\nSaw it happen\nHeard a rumor',
        ),
      ],
    })
    expect(out).toContain('The bridge fell\nAt dawn.\nSaw it happen\nHeard a rumor')
  })

  it('puts pinned and ranked lore under one header, pinned first', () => {
    const out = renderMacro({
      ...EMPTY,
      structuralPinnedLore: [floorLore],
      retrievedLore: [ranked('lore_1', 'Veilstone', 'Veilstone\nA shard.')],
    })
    expect(out.split('# Relevant lore')).toHaveLength(2)
    expect(out.indexOf('The Concord')).toBeLessThan(out.indexOf('Veilstone'))
    expect(out).toContain('Signed at the river.')
  })

  // Whole render, not substrings: the three row families share one shape and one header the way
  // lore's and threads' do, and a second header would still leave every substring assertion green.
  it('puts pinned, faction and ranked entities under one header, in that order', () => {
    const faction = {
      id: 'fact_1',
      kind: 'faction',
      name: 'The Silver Hand',
      description: null,
      status: 'active',
      state: emptyEntityView('faction'),
    }
    const out = renderMacro({
      ...EMPTY,
      structuralPinnedEntities: [floorEntity],
      structuralSceneFactions: [faction],
      retrievedEntities: [rankedMira],
    })
    expect(out).toBe(
      '# Elsewhere in the world\n\n[char_9] Old Sesk: A ferryman long dead.\n\n[fact_1] The Silver Hand\n\n[char_2] Mira (not in the scene): A courier.\n\n',
    )
  })

  // A pinned row bypasses the ranker, so the macro frames it from its status the way the
  // mirror frames a candidate. Without it a pinned staged character reads as an existing
  // off-scene figure rather than one the model may introduce.
  it.each([
    ['active', entityFraming('character', 'active')],
    ['staged', entityFraming('character', 'staged')],
  ])('frames a pinned %s entity the same way the ranker frames a candidate', (status, framing) => {
    const out = renderMacro({
      ...EMPTY,
      structuralPinnedEntities: [{ ...floorEntity, status }],
    })
    expect(out).toContain(`[char_9] Old Sesk (${framing}): A ferryman long dead.`)
  })

  it('leaves a pinned retired entity, and an active faction, unframed', () => {
    const out = renderMacro({ ...EMPTY, structuralPinnedEntities: [floorEntity] })
    expect(out).toContain('[char_9] Old Sesk: A ferryman long dead.')
    expect(out).not.toContain('(')
    const faction = {
      ...floorEntity,
      kind: 'faction',
      status: 'active',
      state: emptyEntityView('faction'),
    }
    expect(renderMacro({ ...EMPTY, structuralSceneFactions: [faction] })).toContain(
      '[char_9] Old Sesk: A ferryman long dead.',
    )
    expect(renderMacro({ ...EMPTY, structuralSceneFactions: [faction] })).not.toContain('(')
  })

  it('puts pinned and ranked non-active threads under one header, pinned first', () => {
    const out = renderMacro({
      ...EMPTY,
      structuralPinnedThreads: [floorThread],
      retrievedThreads: [ranked('thr_1', 'The ledger', 'The ledger (failed)\nStill missing.')],
    })
    expect(out.split('# Background threads')).toHaveLength(2)
    expect(out.indexOf('The debt')).toBeLessThan(out.indexOf('The ledger'))
    expect(out).toContain('Still missing.')
  })

  // data-model.md → threads: "failed is distinct because lumping them together
  // loses useful information". A header that says only "not active" lumps them,
  // and a paid debt rendered like an open one has the model write the character
  // still dodging it.
  it.each(['pending', 'resolved', 'failed'])(
    'marks a pinned %s thread with its status',
    (status) => {
      const out = renderMacro({ ...EMPTY, structuralPinnedThreads: [{ ...floorThread, status }] })
      expect(out).toContain(`The debt (${status})`)
    },
  )

  it('renders a chapter from its renderedText alone — the title rides inside it', () => {
    const out = renderMacro({
      ...EMPTY,
      retrievedChapters: [
        ranked('chap_1', 'The Long Road', 'The Long Road\nShe left the capital.\nDeparture.'),
      ],
    })
    expect(out).toContain('The Long Road\nShe left the capital.\nDeparture.')
    // The measured cost is countTokens(renderedText); a title on a `##` line
    // outside it is length the type budget never charged for.
    expect(out).not.toContain('##')
  })

  // per-turn.ts guards the identical case for structuralLocation. Every
  // structural row is a raw column projection, so every nullable column needs
  // the same guard or its separator ships without its value. Asserted as whole
  // renders, not substrings: an unguarded newline separator is invisible to
  // toContain, since the block's own trailer supplies an identical one.
  const activeThread = { ...floorThread, status: 'active' }
  const nullColumn: [key: string, populated: object, nulled: object, whole: string][] = [
    [
      'structuralPinnedEntities',
      floorEntity,
      { ...floorEntity, description: null },
      '# Elsewhere in the world\n\n[char_9] Old Sesk\n\n',
    ],
    [
      'structuralPinnedLore',
      floorLore,
      { ...floorLore, body: null },
      '# Relevant lore\n\nThe Concord\n\n',
    ],
    [
      'structuralPinnedThreads',
      floorThread,
      { ...floorThread, description: null },
      '# Background threads\n\nThe debt (pending)\n\n',
    ],
    [
      'structuralActiveThreads',
      activeThread,
      { ...activeThread, description: null },
      '# Active threads\n\nThe debt\n\n',
    ],
  ]

  it.each(nullColumn)(
    'drops the separator when a %s row has a null column',
    (key, populated, nulled, whole) => {
      expect(renderMacro({ ...EMPTY, [key]: [nulled] })).toBe(whole)
      // Positive control: the same row with the column filled does emit the
      // separator, so the assertion above is not passing on a dead render.
      expect(renderMacro({ ...EMPTY, [key]: [populated] })).not.toBe(whole)
    },
  )

  it('matches the recorded snapshot with every block populated', () => {
    expect(
      renderMacro({
        ...EMPTY,
        structuralPinnedEntities: [floorEntity],
        structuralPinnedLore: [floorLore],
        structuralPinnedThreads: [floorThread],
        structuralActiveThreads: [
          { id: 'thr_8', status: 'active', title: 'The siege', description: 'Three weeks in.' },
        ],
        retrievedEntities: [rankedMira],
        retrievedLore: [ranked('lore_1', 'Veilstone', 'Veilstone\nA shard of the old moon.')],
        retrievedHappenings: [
          ranked('hap_1', 'The bridge fell', 'The bridge fell\nAt dawn.\nSaw it happen'),
        ],
        retrievedThreads: [ranked('thr_1', 'The ledger', 'The ledger (failed)\nStill missing.')],
        retrievedChapters: [
          ranked('chap_1', 'The Long Road', 'The Long Road\nShe left the capital.\nDeparture.'),
        ],
      }),
    ).toMatchSnapshot()
  })

  it('keeps active threads out of the non-active block', () => {
    const out = renderMacro({
      ...EMPTY,
      structuralActiveThreads: [{ ...floorThread, status: 'active', title: 'The siege' }],
    })
    expect(out).toContain('# Active threads')
    expect(out).toContain('The siege')
    expect(out).not.toContain('# Background threads')
  })
})

// retrieval.md → Token estimation: an entity row renders from its view through the entity-state
// macro, and the ranker measures entityRenderedText, a code mirror of that row. The two must agree
// exactly, or a type overruns its partition by the difference on every row.
describe('memory-blocks macro — entity rows equal their measured mirror', () => {
  const SCENE: ViewScene = { sceneEntities: [], currentLocationId: null }
  const WORLD: Entity[] = [
    makeEntity({
      id: 'char_k',
      kind: 'character',
      name: 'Kael',
      description: 'A scarred ex-soldier turned smuggler.',
      state: {
        visual: {
          physique: "tall, broad-shouldered, a soldier's posture gone slack",
          face: 'a scar through one brow',
          hair: 'close-cropped, grey at the temples',
          eyes: 'pale',
          attire: 'a salt-stained greatcoat over a leather jerkin; knee boots',
          distinguishing: 'a limp',
        },
        traits: ['wary', 'loyal to a fault'],
        drives: ['clear his brother’s name'],
        voice: 'clipped, never wastes a word; calls everyone "friend"',
        current_location_id: 'loc_docks',
        equipped_items: [HELD_ITEM_ID_STAND_IN],
        inventory: ['item_key', 'item_rope', 'item_secret', 'item_ring'],
        stackables: { gold: 30, arrows: 12 },
        faction_id: 'fact_hand',
        lastSeenAt: null,
      },
    }),
    makeEntity({
      id: HELD_ITEM_ID_STAND_IN,
      kind: 'item',
      name: 'Sword of Vael',
      description: 'a blade that glows near the dead',
      state: { at_location_id: null, condition: 'cracked near the hilt' },
    }),
    makeEntity({
      id: 'item_key',
      kind: 'item',
      name: 'Silver Key',
      description: 'opens the vault.\nUnder the chapel.',
      state: { at_location_id: null, condition: 'bent' },
    }),
    makeEntity({
      id: 'item_rope',
      kind: 'item',
      name: 'rope',
      state: { at_location_id: null, condition: 'frayed' },
    }),
    makeEntity({
      id: 'item_secret',
      kind: 'item',
      name: 'Hidden Letter',
      injectionMode: 'disabled',
      state: { at_location_id: null },
    }),
    makeEntity({
      id: 'item_ring',
      kind: 'item',
      name: 'Ring',
      status: 'retired',
      state: { at_location_id: null },
    }),
    makeEntity({
      id: 'fact_hand',
      kind: 'faction',
      name: 'The Silver Hand',
      description: 'Smugglers.',
      state: { standing: 'embattled in the south', agenda: ['hold the docks', 'find the heir'] },
    }),
    makeEntity({
      id: 'fact_veil',
      kind: 'faction',
      name: 'The Veil',
      status: 'staged',
      injectionMode: 'disabled',
    }),
    makeEntity({
      id: 'char_zev',
      kind: 'character',
      name: 'Zev',
      status: 'retired',
      state: { faction_id: 'fact_hand', inventory: ['item_oar'], equipped_items: [] } as never,
    }),
    makeEntity({ id: 'item_oar', kind: 'item', name: 'Oar', state: { at_location_id: null } }),
    makeEntity({ id: 'fact_old', kind: 'faction', name: 'The Old Guard', status: 'retired' }),
    makeEntity({ id: 'loc_sunk', kind: 'location', name: 'Saltmere', status: 'retired' }),
    makeEntity({
      id: 'loc_crypt',
      kind: 'location',
      name: 'The Crypt',
      state: { parent_location_id: 'loc_sunk' },
    }),
    makeEntity({
      id: 'char_drift',
      kind: 'character',
      name: 'Dalen',
      state: {
        faction_id: 'fact_old',
        current_location_id: 'loc_sunk',
        inventory: [],
        equipped_items: [],
      } as never,
    }),
    makeEntity({
      id: 'char_o',
      kind: 'character',
      name: 'Orin',
      description: '  ',
      state: { faction_id: 'fact_veil', inventory: [], equipped_items: [] } as never,
    }),
    makeEntity({ id: 'loc_rift', kind: 'location', name: 'The Rift', injectionMode: 'disabled' }),
    makeEntity({
      id: 'loc_docks',
      kind: 'location',
      name: 'The Docks',
      state: { parent_location_id: 'loc_port', condition: 'half-flooded' },
    }),
    makeEntity({ id: 'loc_port', kind: 'location', name: 'Port Vellis' }),
    makeEntity({
      id: 'loc_chapel',
      kind: 'location',
      name: 'The Chapel',
      status: 'staged',
      state: { parent_location_id: 'loc_rift' },
    }),
    makeEntity({
      id: 'item_lamp',
      kind: 'item',
      name: 'Lamp',
      description: 'brass, still warm!',
      state: { at_location_id: 'loc_docks', condition: 'dented' },
    }),
    makeEntity({ id: 'char_empty', kind: 'character', name: 'Nobody', state: null }),
    makeEntity({
      id: 'char_wren',
      kind: 'character',
      name: 'Wren',
      state: {
        visual: {
          physique: 'lean,\nwiry',
          face: 'freckled\n\nand sunburnt',
          hair: 'red\nand braided',
          eyes: 'green\r\nand narrow',
          attire: 'oilskins\nand a knife belt',
          distinguishing: 'a missing\nfinger',
        },
        traits: ['quick\nto laugh', 'stubborn'],
        drives: ['find\nher brother', 'pay the debt'],
        voice: 'clipped\ncalls everyone friend',
        inventory: ['item_horn', 'item_chart'],
        equipped_items: [],
      } as never,
    }),
    makeEntity({
      id: 'item_horn',
      kind: 'item',
      name: 'Horn',
      description: 'loud enough to wake the dead!',
      state: { at_location_id: null, condition: 'chipped\nat the rim' },
    }),
    makeEntity({
      id: 'item_chart',
      kind: 'item',
      name: 'Chart',
      description: 'but where does it lead?',
      state: { at_location_id: null, condition: 'water-stained' },
    }),
    makeEntity({
      id: 'loc_weir',
      kind: 'location',
      name: 'The Weir',
      state: { parent_location_id: null, condition: 'silted\nup' },
    }),
    makeEntity({
      id: 'item_box',
      kind: 'item',
      name: 'Strongbox',
      state: { at_location_id: 'loc_sunk', condition: 'rusted\nshut' },
    }),
    makeEntity({
      id: 'fact_tide',
      kind: 'faction',
      name: 'The Tide Court',
      state: { standing: 'feared\nin the north', agenda: ['tax\nthe river', 'keep the weir'] },
    }),
  ]
  const views = buildEntityViews(WORLD, SCENE)
  const measured = (id: string): MeasuredEntity =>
    measuredEntity(WORLD.find((e) => e.id === id)!, views)

  // Each kind, and each edge the macro and the mirror must agree on: empty fields, a blank or
  // missing description, held items with and without a description or condition, one ending each
  // kind of sentence, a multi-line one, a multi-line value under every label, members some
  // retired, disabled references (a faction, an item, a parent place) and a retired item left
  // out, retired references marked, framing per kind and status.
  const fixtures: [label: string, id: string][] = [
    ['a fully described character', 'char_k'],
    ['a character with a disabled faction and a blank description', 'char_o'],
    ['a retired character', 'char_zev'],
    ['a character with no stored state', 'char_empty'],
    ['a location with a condition and a parent', 'loc_docks'],
    ['a staged location whose parent is disabled', 'loc_chapel'],
    ['an item lying at a place', 'item_lamp'],
    ['a held item', HELD_ITEM_ID_STAND_IN],
    ['an active faction, members some retired', 'fact_hand'],
    ['a staged faction', 'fact_veil'],
    ['a character whose faction and last-seen place are retired', 'char_drift'],
    ['a location whose parent is retired', 'loc_crypt'],
    ['an item whose holder is retired', 'item_oar'],
    ['a character with multi-line values and held items ending ! and ?', 'char_wren'],
    ['a location with a multi-line condition', 'loc_weir'],
    ['an item with a multi-line condition, lying at a retired place', 'item_box'],
    ['a faction with a multi-line standing and agenda', 'fact_tide'],
  ]
  const lists = ['structuralPinnedEntities', 'structuralSceneFactions', 'retrievedEntities']
  // The mirror measures every held item's id through the stand-in (retrieval.md → Token
  // estimation), so the render's held ids, and nothing else, map to it before comparing.
  const asMeasured = (rendered: string, entity: MeasuredEntity): string =>
    entity.kind === 'character'
      ? entity.state.holdings.reduce(
          (text, h) => text.replaceAll(`[${h.id}] `, `[${HELD_ITEM_ID_STAND_IN}] `),
          rendered,
        )
      : rendered

  it.each(lists.flatMap((list) => fixtures.map(([label, id]) => [list, label, id] as const)))(
    'renders a %s row for %s exactly as its mirror',
    (list, _label, id) => {
      const entity = measured(id)
      const row = entityRowOf('c1', entity, list === 'retrievedEntities')
      expect(asMeasured(renderMacro({ ...EMPTY, [list]: [row] }), entity)).toBe(
        `# Elsewhere in the world\n\n[c1] ${entityRenderedText(entity)}\n\n`,
      )
    },
  )

  // Guards the fixtures: an all-empty view would let a macro that prints no state pass.
  it('exercises every kind’s state lines, held items included', () => {
    const text = fixtures.map(([, id]) => entityRenderedText(measured(id))).join('\n')
    for (const line of [
      'Location: The Docks',
      'Physique:',
      'Face:',
      'Hair:',
      'Eyes:',
      'Attire:',
      'Distinguishing:',
      'Voice:',
      'Traits: wary; loyal to a fault',
      'Drives:',
      'Faction: The Silver Hand',
      'Holds:',
      `- [${HELD_ITEM_ID_STAND_IN}] Sword of Vael (equipped): a blade that glows near the dead. Condition: cracked near the hilt`,
      `- [${HELD_ITEM_ID_STAND_IN}] Silver Key: opens the vault. Under the chapel. Condition: bent`,
      `- [${HELD_ITEM_ID_STAND_IN}] rope. Condition: frayed`,
      'Stackables: gold 30, arrows 12',
      'Condition: half-flooded',
      'Part of: Port Vellis',
      'Held by: Kael',
      'Standing: embattled in the south',
      'Agenda: hold the docks; find the heir',
      'Members: Kael',
      'Faction: The Old Guard (retired)',
      'Location: Saltmere (retired)',
      'Part of: Saltmere (retired)',
      'Held by: Zev (retired)',
      'Physique: lean, wiry',
      'Face: freckled and sunburnt',
      'Hair: red and braided',
      'Eyes: green and narrow',
      'Attire: oilskins and a knife belt',
      'Distinguishing: a missing finger',
      'Voice: clipped calls everyone friend',
      'Traits: quick to laugh; stubborn',
      'Drives: find her brother; pay the debt',
      `- [${HELD_ITEM_ID_STAND_IN}] Horn: loud enough to wake the dead! Condition: chipped at the rim`,
      `- [${HELD_ITEM_ID_STAND_IN}] Chart: but where does it lead? Condition: water-stained`,
      'Condition: silted up',
      'Condition: rusted shut\nLocation: Saltmere (retired)',
      'Standing: feared in the north',
      'Agenda: tax the river; keep the weir',
    ])
      expect(text).toContain(line)
    // Left out as references: a disabled item and faction, a retired item, a disabled parent, a
    // retired member. Line-anchored, since a fixture of its own may print the same name.
    for (const absent of [
      /Hidden Letter/,
      /- \[\S+\] Ring/,
      /^Faction: The Veil$/m,
      /^Part of: The Rift$/m,
    ])
      expect(text).not.toMatch(absent)
    expect(text).toMatch(/^Members: Kael$/m)
  })
})

// retrieval.md → Token estimation: the ranker charges
// countTokens(renderedText) + typeOverhead[type] for every row it seats, so
// typeOverhead has to be this macro's own wrapping cost. Measured by rendering
// exactly one row of the block with no content of its own and counting what is
// left; a macro edit that changes the wrapper fails here until the constant
// follows. What the one-row basis buys, and where it stops being conservative,
// is recorded there too.
const CONSTANT_PATH = 'lib/retrieval/constants.ts → RANKER_DEFAULTS.typeOverhead'

const OVERHEAD_BUCKET: Record<RetrievalType, string> = {
  entities: 'retrievedEntities',
  lore: 'retrievedLore',
  happenings: 'retrievedHappenings',
  threads: 'retrievedThreads',
  chapters: 'retrievedChapters',
}

// `ids` true is the costlier of the two shapes — it brackets an id beside every
// entity row — and the ranker has no per-turn flag to branch on. `c1` is the
// substituted-placeholder shape an id actually has at prompt time. Entity
// placeholders are a single letter plus a counter (lib/ids/prefixes.ts →
// PLACEHOLDER_PREFIX_BY_KIND) and every one up to three digits costs the same 4
// tokens, so only a branch seating a four-digit id under-charges, by one. An entity
// row renders from its data, so its probe row is a nameless retired character with
// an empty view, whose mirror is the empty string.
const PROBE_ROW = { id: 'c1', displayName: '', renderedText: '' }
const ENTITY_PROBE_ROW = {
  ...PROBE_ROW,
  kind: 'character',
  name: '',
  description: null,
  status: 'retired',
  state: emptyEntityView('character'),
} as const

describe('per-type overhead constants', () => {
  const types = Object.keys(OVERHEAD_BUCKET) as RetrievalType[]
  const probeRowFor = (type: RetrievalType) => (type === 'entities' ? ENTITY_PROBE_ROW : PROBE_ROW)

  it('probes entities with a row whose mirror is empty', () => {
    expect(entityRenderedText(ENTITY_PROBE_ROW)).toBe('')
  })

  it.each(types)('typeOverhead.%s is what the macro wrapper actually costs', (type) => {
    const measured = countTokens(
      renderMacro({ ...EMPTY, [OVERHEAD_BUCKET[type]]: [probeRowFor(type)] }),
    )
    // Guards the equality below against a macro that renders nothing: a
    // zero-cost wrapper would let a zeroed constant pass silently.
    expect(measured).toBeGreaterThan(0)
    // Whoever trips this is editing a Liquid template and has no reason to know
    // the constant exists, so the message has to name it and the new value.
    expect(
      RANKER_DEFAULTS.typeOverhead[type],
      `The ${type} block's wrapper now costs ${measured} tokens. Set ${CONSTANT_PATH}.${type} to ${measured}.`,
    ).toBe(measured)
  })

  // The overhead above is measured with displayName: '', so a block that starts
  // rendering the title costs nothing on the probe row and everything in
  // production — ~20 seated rows carrying an uncharged title overrun their
  // partition, and the snapshot diff reads as an intentional "show lore titles".
  // A ranked row is measured on renderedText, or for an entity on the mirror of
  // its data: nothing else may vary the output length.
  it.each(types)('%s rows render nothing whose length the ranker did not charge', (type) => {
    const withRow = (displayName: string, renderedText: string) =>
      renderMacro({
        ...EMPTY,
        [OVERHEAD_BUCKET[type]]: [{ ...probeRowFor(type), displayName, renderedText }],
      })

    expect(withRow('x'.repeat(200), 'The body.')).toBe(withRow('x', 'The body.'))
    // An entity row renders from its data, so its measured string never reaches the prompt.
    if (type === 'entities') expect(withRow('x', 'y'.repeat(200))).toBe(withRow('x', 'The body.'))
  })
})
