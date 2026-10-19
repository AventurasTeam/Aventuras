import { describe, expect, it } from 'vitest'

import type { Entity } from '@/lib/db'
import { makeEntity } from '@/lib/list-modules/__tests__/fixtures'
import { buildEntityViews } from '@/lib/world'

import {
  entityFraming,
  entityHead,
  entityRenderedText,
  entityStateLines,
  HELD_ITEM_ID_STAND_IN,
  itemLine,
  measuredEntity,
} from './rendered-text'
import { countTokens } from './tokens'

const NO_SCENE = { sceneEntities: [], currentLocationId: null }

describe('entityFraming', () => {
  it('frames active and staged rows, and leaves a retired row and an active faction bare', () => {
    expect(entityFraming('character', 'active')).toBe('currently elsewhere')
    expect(entityFraming('faction', 'staged')).toBe('available to introduce')
    expect(entityFraming('faction', 'active')).toBeNull()
    expect(entityFraming('character', 'retired')).toBeNull()
  })
})

describe('entityHead', () => {
  it('drops the separator for a blank description, as Liquid’s `blank` does', () => {
    const row = { kind: 'character' as const, name: 'Kael', status: 'retired' as const }
    expect(entityHead({ ...row, description: '  \n' })).toBe('Kael')
    expect(entityHead({ ...row, description: null })).toBe('Kael')
    expect(entityHead({ ...row, description: 'A smuggler.' })).toBe('Kael: A smuggler.')
  })
})

describe('itemLine', () => {
  const sword = { name: 'Sword', description: null, condition: null }

  it('prints id, name, equipped, description and condition', () => {
    expect(
      itemLine({ ...sword, equipped: true, description: 'a blade', condition: 'cracked' }, 'i2'),
    ).toBe('- [i2] Sword (equipped): a blade. Condition: cracked')
  })

  it('opens a condition with a period when there is no description', () => {
    expect(itemLine({ ...sword, condition: 'notched' }, null)).toBe('- Sword. Condition: notched')
  })

  it.each(['.', '!', '?'])('adds no second stop after a description ending in %s', (stop) => {
    expect(itemLine({ ...sword, description: `a blade${stop}`, condition: 'cracked' }, null)).toBe(
      `- Sword: a blade${stop} Condition: cracked`,
    )
  })

  it('keeps a multi-line description and condition on its one line', () => {
    expect(
      itemLine(
        { ...sword, description: 'a blade\n\nthat glows', condition: 'cracked\nhilt' },
        null,
      ),
    ).toBe('- Sword: a blade that glows. Condition: cracked hilt')
  })
})

describe('entityStateLines', () => {
  const entities: Entity[] = [
    makeEntity({
      id: 'char_k',
      kind: 'character',
      name: 'Kael',
      state: {
        visual: { physique: 'tall', attire: 'a greatcoat' },
        traits: ['wary', 'loyal'],
        drives: ['clear his name'],
        voice: 'clipped',
        faction_id: 'fact_h',
        current_location_id: 'loc_d',
        inventory: ['item_k'],
        equipped_items: ['item_s'],
        stackables: { gold: 30, arrows: 12 },
        lastSeenAt: null,
      },
    }),
    makeEntity({ id: 'fact_h', kind: 'faction', name: 'The Silver Hand' }),
    makeEntity({ id: 'loc_d', kind: 'location', name: 'The Docks' }),
    makeEntity({ id: 'item_k', kind: 'item', name: 'Key', state: { at_location_id: null } }),
    makeEntity({
      id: 'item_s',
      kind: 'item',
      name: 'Sword',
      description: 'glows near the dead',
      state: { at_location_id: null, condition: 'cracked' },
    }),
  ]
  const views = buildEntityViews(entities, NO_SCENE)
  const kael = { kind: 'character' as const, state: views.of('char_k', 'character') }

  it('prints a character in canon’s example order, Location only out of scene', () => {
    expect(entityStateLines(kael, { here: false, heldId: (id) => id })).toEqual([
      'Location: The Docks',
      'Physique: tall',
      'Attire: a greatcoat',
      'Voice: clipped',
      'Traits: wary; loyal',
      'Drives: clear his name',
      'Faction: The Silver Hand',
      'Holds:',
      '- [item_k] Key',
      '- [item_s] Sword (equipped): glows near the dead. Condition: cracked',
      'Stackables: gold 30, arrows 12',
    ])
    expect(entityStateLines(kael, { here: true, heldId: null })[0]).toBe('Physique: tall')
  })

  it('keeps the Holds label but leaves out its item lines on request', () => {
    const out = entityStateLines(kael, { here: true, heldId: null, heldLines: false })
    expect(out.slice(-2)).toEqual(['Holds:', 'Stackables: gold 30, arrows 12'])
  })

  it('prints a location, an item and a faction, with nothing for an empty field', () => {
    expect(
      entityStateLines(
        {
          kind: 'location',
          state: { condition: 'half-burned', parent: { id: 'l', name: 'Port', status: 'active' } },
        },
        { here: false, heldId: null },
      ),
    ).toEqual(['Condition: half-burned', 'Part of: Port'])
    expect(
      entityStateLines(
        {
          kind: 'item',
          state: {
            condition: null,
            location: null,
            holder: { id: 'c', name: 'Kael', status: 'active', equipped: true },
          },
        },
        { here: false, heldId: null },
      ),
    ).toEqual(['Held by: Kael'])
    expect(
      entityStateLines(
        {
          kind: 'faction',
          state: {
            standing: null,
            agenda: ['take the port', 'hold it'],
            members: [
              { id: 'a', name: 'Aria', status: 'active' },
              { id: 'z', name: 'Zev', status: 'retired' },
            ],
          },
        },
        { here: false, heldId: null },
      ),
    ).toEqual(['Agenda: take the port; hold it', 'Members: Aria'])
  })
})

describe('entityRenderedText', () => {
  it('is the head, then the out-of-scene state lines, held ids through the stand-in', () => {
    const entities = [
      makeEntity({
        id: 'char_00000000-0000-4000-8000-0000000000c1',
        kind: 'character',
        name: 'Kael',
        description: 'A smuggler.',
        state: {
          equipped_items: ['item_00000000-0000-4000-8000-0000000000d1'],
          inventory: [],
        } as Entity['state'],
      }),
      makeEntity({ id: 'item_00000000-0000-4000-8000-0000000000d1', kind: 'item', name: 'Sword' }),
    ]
    const entity = measuredEntity(entities[0]!, buildEntityViews(entities, NO_SCENE))
    const text = entityRenderedText(entity)
    expect(text).toBe(
      `Kael (currently elsewhere): A smuggler.\nHolds:\n- [${HELD_ITEM_ID_STAND_IN}] Sword (equipped)`,
    )
    // substituteIds replaces whole-string ids only, so one inside the text would leak raw.
    expect(text).not.toMatch(/(char|item)_[0-9a-f]{8}-/)
  })

  // retrieval.md → Token estimation: "a stand-in placeholder of realistic width".
  it('measures the stand-in at a real two-digit placeholder’s cost', () => {
    expect(countTokens(`- [${HELD_ITEM_ID_STAND_IN}] Sword`)).toBe(countTokens('- [i10] Sword'))
  })
})
