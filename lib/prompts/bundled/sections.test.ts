import { describe, expect, it } from 'vitest'

import type { Entity } from '@/lib/db'
import { makeEntity } from '@/lib/list-modules/__tests__/fixtures'
import { buildEntityViews, emptyEntityView } from '@/lib/world'

import { createEngine, renderWith, templateGlobals } from '../engine'
import { TEMPLATE_IDS } from '../ids'
import { bundledPack } from './index'
import type { HalfSections, Pack, PromptSectionId } from '../types'

// architecture.md → Prompt sections: the tags add no bytes and hide nothing from static analysis,
// so the pack with every section tag deleted must render and read exactly as the tagged one.
const TAG = /\{%-?\s*(?:section\s+'[^']*'|endsection)\s*-?%\}/g
const strip = (source: string): string => source.replace(TAG, '')

const untaggedPack: Pack = {
  templates: Object.fromEntries(
    Object.entries(bundledPack.templates).map(([id, entry]) => [
      id,
      { ...entry, system: strip(entry.system), user: strip(entry.user) },
    ]),
  ),
  macros: Object.fromEntries(
    Object.entries(bundledPack.macros).map(([id, entry]) => [
      id,
      { ...entry, source: strip(entry.source) },
    ]),
  ),
}
const tagged = createEngine(bundledPack)
const untagged = createEngine(untaggedPack)

const KAEL = makeEntity({
  id: 'c1',
  kind: 'character',
  name: 'Kael',
  description: 'A courier with a stolen sigil.',
  state: { inventory: ['i3'], equipped_items: [] } as never,
})
const KEEP = makeEntity({
  id: 'l1',
  kind: 'location',
  name: 'The Drowned Keep',
  description: 'Half sunk into the marsh.',
})
const SEAL = makeEntity({
  id: 'i3',
  kind: 'item',
  name: 'Courier’s seal',
  state: { at_location_id: null },
})
const LANTERN = makeEntity({
  id: 'i5',
  kind: 'item',
  name: 'a rusted lantern',
  state: { at_location_id: 'l1' },
})
const WORLD: Entity[] = [KAEL, KEEP, SEAL, LANTERN]

function project(rows: Entity[], sceneEntities: string[]) {
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

const projected = project(WORLD, ['c1', 'l1'])

// Every bucket non-empty, so every section renders.
const everything: Record<string, unknown> = {
  definition: {
    mode: 'adventure',
    narration: 'second',
    genre: { label: 'Fantasy', promptBody: 'Low fantasy, grim and close.' },
    tone: { label: 'Wry', promptBody: 'Dry humour under pressure.' },
    setting: 'A drowned kingdom of marsh and ruin.',
  },
  lead: { id: 'c1', name: 'Kael' },
  entities: projected,
  sceneEntities: ['c1', 'l1'],
  structuralLocation: projected.find((e) => e.id === 'l1'),
  currentLocationChain: ['The Marsh'],
  currentTime: 'Day 12, dusk',
  looseItems: projected.filter((e) => e.id === 'i5'),
  heldItems: [],
  locationIds: ['l1'],
  placesListed: true,
  locationMap: [
    { id: 'l2', name: 'The Marsh', depth: 0 },
    { id: 'l1', name: 'The Drowned Keep', depth: 1 },
  ],
  locationMapUnplaced: [{ id: 'l9', name: 'Varn', depth: 0 }],
  structuralActiveThreads: [
    { id: 't1', status: 'active', title: 'Find the heir', description: 'Still open.' },
  ],
  structuralPinnedEntities: [],
  structuralSceneFactions: [],
  structuralPinnedLore: [{ id: 'lore_1', title: 'House Eldrin', body: 'An exiled line.' }],
  structuralPinnedThreads: [
    { id: 't2', status: 'background', title: 'Old debts', description: '' },
  ],
  retrievedEntities: [
    {
      id: 'c7',
      displayName: 'Mora',
      renderedText: 'never rendered',
      kind: 'character',
      name: 'Mora',
      description: 'Last seen at the ford.',
      status: 'active',
      state: emptyEntityView('character'),
    },
  ],
  retrievedLore: [
    { id: 'lore_2', displayName: 'Veilstone', renderedText: 'Veilstone\nA shard of the old moon.' },
  ],
  retrievedHappenings: [
    { id: 'h1', displayName: 'The siege', renderedText: 'The siege broke on the third night.' },
  ],
  retrievedThreads: [
    { id: 't3', displayName: 'The ford', renderedText: 'The ford: who holds it.' },
  ],
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
      state: emptyEntityView('character'),
    },
  ],
  entries: [
    { position: 1, kind: 'opening', content: 'The marsh road ended at a wall of black water.' },
    { position: 2, kind: 'user_action', content: 'I test the stones' },
    {
      position: 3,
      kind: 'ai_reply',
      content: 'The keep answered with a single lantern, swinging.',
    },
  ],
  lastTurns: [
    { position: 1, kind: 'opening', content: 'The marsh road ended at a wall of black water.' },
    { position: 2, kind: 'user_action', content: 'I test the stones' },
    {
      position: 3,
      kind: 'ai_reply',
      content: 'The keep answered with a single lantern, swinging.',
    },
  ],
  calendarVocabulary: {
    baseUnitName: 'day',
    secondsPerBaseUnit: 86400,
    tiers: [{ name: 'month', labels: ['Frostmoon', 'Thawmoon'] }],
  },
  worldTimeDeltaBasis: 'sinceLastAiReply',
  suggestionSlots: [{ ref: 'cat1', label: 'Action', promptHint: 'A decisive move.' }],
  suggestionCount: 3,
  composerWrapPov: 'second',
  piggybackFires: true,
  suggestionsFire: true,
}

const EMPTY_MEMORY = {
  structuralActiveThreads: [],
  structuralPinnedEntities: [],
  structuralSceneFactions: [],
  structuralPinnedLore: [],
  structuralPinnedThreads: [],
  retrievedEntities: [],
  retrievedLore: [],
  retrievedHappenings: [],
  retrievedThreads: [],
  retrievedChapters: [],
}

const VARIANTS: [string, Record<string, unknown>][] = [
  ['everything', {}],
  ['piggyback off', { piggybackFires: false }],
  ['suggestions off', { suggestionsFire: false }],
  ['piggyback and suggestions off', { piggybackFires: false, suggestionsFire: false }],
  ['empty memory buckets', EMPTY_MEMORY],
  [
    'no location',
    {
      structuralLocation: null,
      looseItems: [],
      currentLocationChain: [],
      locationMap: [],
      locationMapUnplaced: [],
      placesListed: false,
    },
  ],
  ['no calendar', { calendarVocabulary: null, currentTime: null }],
  ['no entries', { entries: [], lastTurns: [] }],
]

const TURN_TEMPLATES = [TEMPLATE_IDS.perTurnNarrative, TEMPLATE_IDS.piggybackFallbackClassifier]

function textOf(half: HalfSections, id: PromptSectionId): string {
  return half.named
    .filter((section) => section.id === id)
    .map((section) => section.text)
    .join('')
}

describe('the bundled pack with section tags', () => {
  it('reads exactly the variables it read untagged, for every template', () => {
    for (const id of Object.keys(bundledPack.templates)) {
      expect([...templateGlobals(tagged, id)].sort(), id).toEqual(
        [...templateGlobals(untagged, id)].sort(),
      )
    }
  })

  it('still reads the history and the scene in both turn templates', () => {
    expect(templateGlobals(tagged, TEMPLATE_IDS.perTurnNarrative)).toContain('entries')
    expect(templateGlobals(tagged, TEMPLATE_IDS.piggybackFallbackClassifier)).toContain('lastTurns')
    for (const id of TURN_TEMPLATES) expect(templateGlobals(tagged, id)).toContain('sceneEntities')
  })

  for (const templateId of TURN_TEMPLATES) {
    for (const [name, over] of VARIANTS) {
      it(`renders ${templateId} byte-identical to untagged: ${name}`, () => {
        const context = { ...everything, ...over }
        const out = renderWith(tagged, templateId, context, { sections: true })

        expect({ system: out.system, user: out.user }).toEqual(
          renderWith(untagged, templateId, context),
        )
        for (const half of ['system', 'user'] as const) {
          const pieces = out.sections[half]
          const length =
            pieces.named.reduce((n, s) => n + s.text.length, 0) +
            pieces.unnamed.reduce((n, text) => n + text.length, 0)
          expect(length).toBe(out[half].length)
        }
      })
    }
  }
})

// architecture.md → Prompt sections, the bundled pack's table.
describe('the bundled pack maps its sections as canon says', () => {
  it('splits the narrative call', () => {
    const { sections } = renderWith(tagged, TEMPLATE_IDS.perTurnNarrative, everything, {
      sections: true,
    })
    const { system, user } = sections

    expect(textOf(system, 'instructions')).toContain(
      "The user's turns are marked with <user_turn> tags",
    )
    expect(textOf(user, 'instructions')).toContain(
      'If any off-scene character above enters the scene',
    )
    expect(textOf(system, 'setup')).toMatch(/# Setting[\s\S]*# Genre[\s\S]*# Tone[\s\S]*# Calendar/)
    expect(textOf(user, 'scene')).toMatch(
      /# In scene[\s\S]*# Current location[\s\S]*# Current time/,
    )
    expect(textOf(user, 'places')).toContain('# Places')
    expect(textOf(user, 'entities')).toContain('# The wider world')
    expect(textOf(user, 'lore')).toContain('# Relevant lore')
    expect(textOf(user, 'happenings')).toContain('# What has happened')
    expect(textOf(user, 'threads')).toMatch(/# Active threads[\s\S]*# Background threads/)
    expect(textOf(user, 'chapters')).toContain('# Earlier chapters')
    expect(textOf(user, 'history')).toMatch(/^# Story so far\n[\s\S]*single lantern, swinging\.\n$/)
    expect(textOf(system, 'output')).toContain('Write the next beat of the story as prose.')
    expect(textOf(user, 'output')).toMatch(/<state>[\s\S]*<suggestions>/)
    expect(sections.system.named.map((s) => s.id)).not.toContain('roster')
  })

  it('splits the fallback classifier', () => {
    const { sections } = renderWith(tagged, TEMPLATE_IDS.piggybackFallbackClassifier, everything, {
      sections: true,
    })
    const { system, user } = sections

    expect(textOf(system, 'setup')).toContain('# Calendar')
    expect(textOf(system, 'instructions')).toContain("# The user's turns")
    expect(textOf(user, 'instructions')).toMatch(/^Report the scene state[\s\S]*stays prose\.\n$/)
    expect(textOf(user, 'roster')).toMatch(
      /^Known entities[\s\S]*The story's lead is \[c1\] Kael\./,
    )
    expect(textOf(user, 'scene')).toMatch(/# In scene[\s\S]*# Current location/)
    expect(textOf(user, 'places')).toContain('# Places')
    expect(textOf(user, 'entities')).toMatch(/# The wider world[\s\S]*# Named in this turn/)
    expect(textOf(user, 'history')).toMatch(
      /^# Earlier turns[\s\S]*# This turn[\s\S]*single lantern, swinging\.\n\n$/,
    )
    expect(textOf(user, 'output')).toContain('suggestions')
    // The framing between the roster and the scene belongs to no section.
    expect(user.unnamed.join('')).toContain('Everything from here to "# This turn"')
  })
})
