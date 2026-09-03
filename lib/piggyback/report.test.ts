import { describe, expect, it } from 'vitest'

import { buildStateReport } from './report'

describe('buildStateReport', () => {
  it('records the emitted values, not the applied ones', () => {
    const report = buildStateReport({
      layer: 'piggyback_tagged_block',
      block: { currentLocation: 'item_sword', worldTimeDelta: -600 },
      failures: [],
      raw: '<state><current_location>item_sword</current_location></state>',
    })
    // apply.ts rejects a non-location id and clamps a negative delta; the report keeps
    // what the model actually said so the reader can show the divergence.
    expect(report?.currentLocation).toBe('item_sword')
    expect(report?.worldTimeDelta).toBe(-600)
  })

  it('records the applied delta alongside the emitted one', () => {
    const report = buildStateReport({
      layer: 'piggyback_tagged_block',
      block: { worldTimeDelta: -600 },
      failures: [],
      applied: { worldTimeDelta: 0, currentLocationRejected: false },
    })
    expect(report?.worldTimeDelta).toBe(-600)
    expect(report?.worldTimeDeltaApplied).toBe(0)
  })

  // The headroom clamp is the case `worldTimeDelta < 0` never caught: a positive
  // emitted value that apply.ts still had to truncate.
  it('records a headroom clamp, which the emitted value alone cannot reveal', () => {
    const report = buildStateReport({
      layer: 'piggyback_tagged_block',
      block: { worldTimeDelta: 9_000_000 },
      failures: [],
      applied: { worldTimeDelta: 120, currentLocationRejected: false },
    })
    expect(report?.worldTimeDelta).toBe(9_000_000)
    expect(report?.worldTimeDeltaApplied).toBe(120)
  })

  it('flags a rejected location only when apply.ts rejected it', () => {
    const rejected = buildStateReport({
      layer: 'piggyback_tagged_block',
      block: { currentLocation: 'item_sword' },
      failures: [],
      applied: { worldTimeDelta: 0, currentLocationRejected: true },
    })
    expect(rejected?.currentLocationRejected).toBe(true)

    // An accepted location must leave the key absent: the panel keys its strikethrough
    // off presence, and a later user edit must not be able to manufacture one.
    const accepted = buildStateReport({
      layer: 'piggyback_tagged_block',
      block: { currentLocation: 'loc_keep' },
      failures: [],
      applied: { worldTimeDelta: 0, currentLocationRejected: false },
    })
    expect(accepted).not.toHaveProperty('currentLocationRejected')
  })

  // Rows written before this field existed, and turns where nothing was applied.
  it('omits the applied delta when no apply outcome is supplied', () => {
    const report = buildStateReport({
      layer: 'per_turn_classifier',
      block: { worldTimeDelta: 30 },
      failures: [],
    })
    expect(report?.worldTimeDelta).toBe(30)
    expect(report).not.toHaveProperty('worldTimeDeltaApplied')
  })

  it('omits raw and failedFields on a clean parse', () => {
    const report = buildStateReport({
      layer: 'piggyback_tagged_block',
      block: { sceneEntities: ['char_a'] },
      failures: [],
      raw: '<state><scene_entities>char_a</scene_entities></state>',
    })
    expect(report).toEqual({ layer: 'piggyback_tagged_block', sceneEntities: ['char_a'] })
  })

  it('keeps raw and failedFields when a field failed', () => {
    const report = buildStateReport({
      layer: 'piggyback_tagged_block',
      block: { sceneEntities: ['char_a'] },
      failures: [{ field: 'transfers', detail: 'content present but no entries' }],
      raw: '<state><transfers><item id="i1"',
    })
    expect(report?.failedFields).toEqual([
      { field: 'transfers', detail: 'content present but no entries' },
    ])
    expect(report?.raw).toBe('<state><transfers><item id="i1"')
  })

  it('records a failure even when no raw text survived', () => {
    const report = buildStateReport({
      layer: 'per_turn_classifier',
      block: {},
      failures: [{ field: 'sceneEntities', detail: 'substitution failed' }],
    })
    expect(report?.layer).toBe('per_turn_classifier')
    expect(report?.failedFields).toHaveLength(1)
    expect(report?.raw).toBeUndefined()
  })

  // The layer badge is the point: a summary-only block still reported state, and with no
  // report at all the entry is indistinguishable from a story with piggyback switched off.
  it('keeps a layer-only report for a block that carried nothing but a summary', () => {
    const report = buildStateReport({
      layer: 'piggyback_tagged_block',
      block: { summary: 'A sentence.' },
      failures: [],
      applied: { worldTimeDelta: 0, currentLocationRejected: false },
    })
    expect(report).toEqual({ layer: 'piggyback_tagged_block' })
  })

  it('returns undefined when no block was found and nothing failed', () => {
    expect(
      buildStateReport({ layer: 'piggyback_tagged_block', block: {}, failures: [] }),
    ).toBeUndefined()
  })

  // summary already has a top-level home on EntryMetadata; duplicating it into the
  // report would give the reader two sources for one sentence.
  it('does not copy summary into the report', () => {
    const report = buildStateReport({
      layer: 'piggyback_tagged_block',
      block: { summary: 'A sentence.', sceneEntities: [] },
      failures: [],
    })
    expect(report).not.toHaveProperty('summary')
  })

  it('carries the full transfer and visual-change shapes through', () => {
    const report = buildStateReport({
      layer: 'piggyback_tagged_block',
      block: {
        visualChanges: [{ id: 'char_a', type: 'attire', text: 'muddied cloak' }],
        transfers: {
          items: [{ id: 'item_a', slot: 'inventory', to: 'char_a', from: 'char_b' }],
          stackables: [{ key: 'gold', amount: 50, to: 'char_a' }],
        },
      },
      failures: [],
    })
    expect(report?.visualChanges).toEqual([{ id: 'char_a', type: 'attire', text: 'muddied cloak' }])
    expect(report?.transfers?.items[0]?.from).toBe('char_b')
    expect(report?.transfers?.stackables[0]?.key).toBe('gold')
  })
})
