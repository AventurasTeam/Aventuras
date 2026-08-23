import { describe, expect, it } from 'vitest'

import { NARRATIVE_LANE } from './routing'
import { STRUCTURED_SHAPES } from './shapes'
import { defaultState, emptyLane, nextResponse, takeFailure, type Lane } from './state'
import { validateLaneValue } from './validate'

function laneWith(names: string[], overrides: Partial<Lane> = {}): Lane {
  const lane = emptyLane()
  lane.responses = names.map((name) => ({ id: name, name, value: { marker: name } }))
  lane.activeId = names[0] ?? null
  lane.sequence.ids = [...names]
  Object.assign(lane, overrides)
  return lane
}

function serve(lane: Lane, times: number): (string | null)[] {
  return Array.from({ length: times }, () => nextResponse(lane)?.name ?? null)
}

describe('nextResponse', () => {
  it('serves the active response repeatedly when sequencing is off', () => {
    const lane = laneWith(['a', 'b', 'c'])
    lane.activeId = 'b'
    expect(serve(lane, 3)).toEqual(['b', 'b', 'b'])
  })

  it('falls back to the first response when activeId points at nothing', () => {
    const lane = laneWith(['a', 'b'])
    lane.activeId = 'deleted'
    expect(serve(lane, 2)).toEqual(['a', 'a'])
  })

  it('cycles and wraps when sequencing loops', () => {
    const lane = laneWith(['a', 'b', 'c'])
    lane.sequence.enabled = true
    expect(serve(lane, 5)).toEqual(['a', 'b', 'c', 'a', 'b'])
  })

  it('holds on the last entry when sequencing does not loop', () => {
    const lane = laneWith(['a', 'b'])
    lane.sequence.enabled = true
    lane.sequence.loop = false
    expect(serve(lane, 4)).toEqual(['a', 'b', 'b', 'b'])
  })

  it('resolves a cursor left out of range by an edit instead of serving nothing', () => {
    const lane = laneWith(['a', 'b'])
    lane.sequence.enabled = true
    lane.sequence.loop = false
    lane.sequence.cursor = 9
    expect(serve(lane, 2)).toEqual(['b', 'b'])
  })

  it('skips sequence ids whose response was deleted', () => {
    const lane = laneWith(['a', 'b', 'c'])
    lane.sequence.enabled = true
    lane.responses = lane.responses.filter((r) => r.id !== 'b')
    expect(serve(lane, 4)).toEqual(['a', 'c', 'a', 'c'])
  })

  it('returns null for a lane with nothing configured', () => {
    expect(nextResponse(emptyLane())).toBeNull()
  })
})

describe('takeFailure', () => {
  it('is inert while remaining is zero, whatever the kind', () => {
    const lane = emptyLane()
    lane.failure = { kind: 'http', status: 500, remaining: 0 }
    expect(takeFailure(lane)).toBe('none')
  })

  it('counts a finite budget down and then stops failing', () => {
    const lane = emptyLane()
    lane.failure = { kind: 'http', status: 429, remaining: 2 }
    expect([takeFailure(lane), takeFailure(lane), takeFailure(lane)]).toEqual([
      'http',
      'http',
      'none',
    ])
    expect(lane.failure.remaining).toBe(0)
  })

  it('never exhausts a -1 budget', () => {
    const lane = emptyLane()
    lane.failure = { kind: 'stream-cut', status: 500, remaining: -1 }
    expect([takeFailure(lane), takeFailure(lane), takeFailure(lane)]).toEqual([
      'stream-cut',
      'stream-cut',
      'stream-cut',
    ])
    expect(lane.failure.remaining).toBe(-1)
  })
})

describe('shipped defaults', () => {
  it('gives every registered shape a lane', () => {
    const lanes = defaultState().lanes
    expect(Object.keys(lanes)).toEqual(
      expect.arrayContaining([NARRATIVE_LANE, ...STRUCTURED_SHAPES.map((s) => s.name)]),
    )
  })

  it('ships at least one reply per lane, since an unconfigured lane answers {}', () => {
    // {} parses for a schema whose fields all default, and fails every schema
    // that requires one — so a lane shipped empty is a wizard step that errors
    // on first use rather than a lane that quietly does nothing.
    for (const [key, lane] of Object.entries(defaultState().lanes)) {
      expect(lane.responses.length, key).toBeGreaterThan(0)
    }
  })

  it('ships only responses their own lane schema accepts', () => {
    for (const [key, lane] of Object.entries(defaultState().lanes)) {
      for (const response of lane.responses) {
        const result = validateLaneValue(key, response.value)
        expect(
          result.ok,
          `${key} / ${response.name}: ${'error' in result ? result.error : ''}`,
        ).toBe(true)
      }
    }
  })

  it('never names an entity placeholder, which is positional and per-run', () => {
    const serialised = JSON.stringify(defaultState().lanes)
    expect(serialised).not.toMatch(/"(c|l|lo|i|f|th|hp|ck)\d+"/)
  })

  it('does not ship an empty suggestion-refresh reply, which fails the run', () => {
    const lane = defaultState().lanes['suggestion-refresh']
    expect(lane?.responses.length).toBeGreaterThan(0)
    for (const response of lane?.responses ?? []) {
      expect((response.value as { suggestions: unknown[] }).suggestions.length).toBeGreaterThan(0)
    }
  })
})
