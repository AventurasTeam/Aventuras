import { describe, expect, it } from 'vitest'

import type { LocationState } from '@/lib/db'

import { isUnplaced, placementOf, realPlacementOf, samePlacement, withPlacement } from './placement'

const row = (state: object | null) => ({ state: state as LocationState | null })

describe('placementOf', () => {
  it('reads a stored parent as under it, a null parent as top-level, the flag as unplaced', () => {
    expect(placementOf(row({ parent_location_id: 'loc_reach' }))).toEqual({
      kind: 'under',
      parentId: 'loc_reach',
    })
    expect(placementOf(row({ parent_location_id: null }))).toEqual({ kind: 'top' })
    expect(placementOf(row({ parent_location_id: null, unplaced: true }))).toEqual({
      kind: 'unplaced',
    })
  })

  // data-model.md → LocationState shape: rows from before the flag keep a null parent's meaning.
  it('reads a null state column, or one without the parent key, as top-level', () => {
    expect(placementOf(row(null))).toEqual({ kind: 'top' })
    expect(placementOf(row({}))).toEqual({ kind: 'top' })
  })
})

describe('isUnplaced', () => {
  it('is true only for the flag', () => {
    expect(isUnplaced(row({ parent_location_id: null, unplaced: true }))).toBe(true)
    expect(isUnplaced(row({ parent_location_id: null }))).toBe(false)
    expect(isUnplaced(row({ parent_location_id: 'loc_reach' }))).toBe(false)
    expect(isUnplaced(row(null))).toBe(false)
  })
})

// data-model.md → LocationState shape: known to exist, not where, on every list of places.
describe('realPlacementOf', () => {
  const place = (id: string, state: LocationState) => ({ id, state })
  const placementAt = realPlacementOf([
    place('loc_eldra', { parent_location_id: null }),
    place('loc_vellis', { parent_location_id: 'loc_eldra' }),
    place('loc_varn', { parent_location_id: null, unplaced: true }),
    place('loc_orphan', { parent_location_id: 'loc_gone' }),
  ])

  it('reads the flag as unplaced, a parent that is a place as under it, none as top-level', () => {
    expect(placementAt('loc_varn')).toEqual({ kind: 'unplaced' })
    expect(placementAt('loc_vellis')).toEqual({ kind: 'under', parentId: 'loc_eldra' })
    expect(placementAt('loc_eldra')).toEqual({ kind: 'top' })
  })

  it('reads a stored parent naming no place as unplaced: its container is gone', () => {
    expect(placementAt('loc_orphan')).toEqual({ kind: 'unplaced' })
  })

  it('reads an id naming no place as top-level', () => {
    expect(placementAt('loc_none')).toEqual({ kind: 'top' })
  })
})

describe('withPlacement', () => {
  const UNPLACED: LocationState = { parent_location_id: null, unplaced: true, condition: 'flooded' }

  it('places an unplaced place under a parent, dropping the flag and keeping its other keys', () => {
    const next = withPlacement(UNPLACED, { kind: 'under', parentId: 'loc_reach' })
    expect(next).toEqual({ parent_location_id: 'loc_reach', condition: 'flooded' })
    expect('unplaced' in next).toBe(false)
  })

  it('marks an unplaced place top-level, dropping the flag', () => {
    const next = withPlacement(UNPLACED, { kind: 'top' })
    expect(next).toEqual({ parent_location_id: null, condition: 'flooded' })
    expect('unplaced' in next).toBe(false)
  })

  it('unplaces a placed place: a null parent beside the flag', () => {
    expect(
      withPlacement(
        { parent_location_id: 'loc_reach', condition: 'flooded' },
        { kind: 'unplaced' },
      ),
    ).toEqual({ parent_location_id: null, unplaced: true, condition: 'flooded' })
  })

  it('never leaves the flag beside a parent, whatever it starts from', () => {
    const starts: LocationState[] = [
      UNPLACED,
      { parent_location_id: 'loc_old' },
      { parent_location_id: null },
    ]
    for (const start of starts) {
      for (const placement of [
        { kind: 'under', parentId: 'loc_new' },
        { kind: 'top' },
        { kind: 'unplaced' },
      ] as const) {
        const next = withPlacement(start, placement)
        expect(next.unplaced === true && next.parent_location_id !== null).toBe(false)
        expect(placementOf({ state: next })).toEqual(placement)
      }
    }
  })

  it('leaves the state it was given untouched', () => {
    const start: LocationState = { parent_location_id: null, unplaced: true }
    withPlacement(start, { kind: 'top' })
    expect(start).toEqual({ parent_location_id: null, unplaced: true })
  })
})

describe('samePlacement', () => {
  it('matches two placements of one kind, and two under the same parent only', () => {
    expect(samePlacement({ kind: 'top' }, { kind: 'top' })).toBe(true)
    expect(samePlacement({ kind: 'unplaced' }, { kind: 'unplaced' })).toBe(true)
    expect(
      samePlacement({ kind: 'under', parentId: 'loc_a' }, { kind: 'under', parentId: 'loc_a' }),
    ).toBe(true)
    expect(
      samePlacement({ kind: 'under', parentId: 'loc_a' }, { kind: 'under', parentId: 'loc_b' }),
    ).toBe(false)
    expect(samePlacement({ kind: 'top' }, { kind: 'unplaced' })).toBe(false)
    expect(samePlacement({ kind: 'under', parentId: 'loc_a' }, { kind: 'top' })).toBe(false)
  })
})
