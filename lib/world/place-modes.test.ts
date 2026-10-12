import { describe, expect, it } from 'vitest'

import type { Entity } from '@/lib/db'
import { makeEntity } from '@/lib/list-modules/__tests__/fixtures'

import { placeModes } from './place-modes'

const location = (
  id: string,
  name: string,
  parent: string | null,
  overrides: Partial<Entity> = {},
): Entity =>
  makeEntity({ id, kind: 'location', name, state: { parent_location_id: parent }, ...overrides })

const ELDRA = location('loc_eldra', 'Eldra', null)
const VELLIS = location('loc_vellis', 'Port Vellis', 'loc_eldra', { injectionMode: 'disabled' })
const ANCHOR = location('loc_anchor', 'The Rusty Anchor', 'loc_vellis')
const BACK_ROOM = location('loc_back', 'the back room', 'loc_anchor', { injectionMode: 'always' })
const MARKET = location('loc_market', 'Harbor Market', 'loc_vellis')
const THORNWOOD = location('loc_thorn', 'Thornwood', null, { injectionMode: 'disabled' })
const WORLD = [ELDRA, VELLIS, ANCHOR, BACK_ROOM, MARKET, THORNWOOD]

const disabledIds = (rows: readonly Entity[], story: string | null): string[] => {
  const modes = placeModes(rows, story)
  return rows.filter((e) => modes.isDisabled(e.id)).map((e) => e.id)
}

describe('placeModes', () => {
  it('disables a place by its own mode and every place inside it, whatever their own', () => {
    expect(disabledIds(WORLD, null)).toEqual([
      'loc_vellis',
      'loc_anchor',
      'loc_back',
      'loc_market',
      'loc_thorn',
    ])
  })

  it('names the nearest disabling ancestor, and none for a place disabled only by itself', () => {
    const modes = placeModes(WORLD, null)
    expect(modes.disabledThrough('loc_back')?.id).toBe('loc_vellis')
    expect(modes.disabledThrough('loc_vellis')).toBeNull()
    expect(modes.disabledThrough('loc_thorn')).toBeNull()
    expect(modes.disabledThrough('loc_eldra')).toBeNull()
  })

  it('names the nearest of two disabling ancestors', () => {
    const rows = [{ ...ELDRA, injectionMode: 'disabled' as const }, VELLIS, ANCHOR]
    expect(placeModes(rows, null).disabledThrough('loc_anchor')?.id).toBe('loc_vellis')
  })

  // data-model.md → LocationState shape: the ancestor's disabling doesn't reach the places around
  // the story, though the ancestor itself stays off the map unless it is the current location.
  it('suspends an ancestor that contains the story, for every place under it', () => {
    expect(disabledIds(WORLD, 'loc_anchor')).toEqual(['loc_vellis', 'loc_thorn'])
    const modes = placeModes(WORLD, 'loc_anchor')
    expect(modes.disabledThrough('loc_market')).toBeNull()
    expect(modes.disabledThrough('loc_back')).toBeNull()
  })

  it('lists the disabled ancestor itself when it is the current location', () => {
    expect(disabledIds(WORLD, 'loc_vellis')).toEqual(['loc_thorn'])
  })

  it('suspends each of nested disabled ancestors the story is inside', () => {
    const rows = [{ ...ELDRA, injectionMode: 'disabled' as const }, VELLIS, ANCHOR, MARKET]
    const saltmere = location('loc_salt', 'Saltmere', 'loc_eldra')
    expect(disabledIds([...rows, saltmere], 'loc_anchor')).toEqual(['loc_eldra', 'loc_vellis'])
  })

  it('keeps an ancestor the story is not inside disabling', () => {
    const shrine = location('loc_shrine', 'Shrine', 'loc_thorn')
    expect(disabledIds([...WORLD, shrine], 'loc_anchor')).toEqual([
      'loc_vellis',
      'loc_thorn',
      'loc_shrine',
    ])
  })

  it('never disables the current location, even by its own mode', () => {
    expect(placeModes(WORLD, 'loc_thorn').isDisabled('loc_thorn')).toBe(false)
  })

  it('answers false for an id that is not a location', () => {
    const kael = makeEntity({
      id: 'char_kael',
      kind: 'character',
      name: 'Kael',
      injectionMode: 'disabled',
    })
    const modes = placeModes([...WORLD, kael], null)
    expect(modes.isDisabled('char_kael')).toBe(false)
    expect(modes.isDisabled('loc_gone')).toBe(false)
    expect(modes.disabledThrough('char_kael')).toBeNull()
  })

  it('terminates on a looping chain', () => {
    const loop = [
      location('loc_la', 'Ashgate', 'loc_lb', { injectionMode: 'disabled' }),
      location('loc_lb', 'Bellmoor', 'loc_la'),
    ]
    expect(disabledIds(loop, null)).toEqual(['loc_la', 'loc_lb'])
  })
})
