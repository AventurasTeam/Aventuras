import { describe, expect, it } from 'vitest'

import { buildStateReport } from './report'
import type {
  NewItemReport,
  NewLocationReport,
  ParsedStateBlock,
  PlannedStateBlock,
  PlannedTurn,
  TurnCreatesReport,
} from './types'

const NO_CREATES: TurnCreatesReport = { newLocations: [], newItems: [] }

// Cast, not planned: these blocks are built with ids and no creates, as the planner hands one on.
function planned(
  block: Omit<ParsedStateBlock, 'newLocations' | 'newItems'>,
  report: TurnCreatesReport = NO_CREATES,
): Pick<PlannedTurn, 'block' | 'report'> {
  return { block: block as PlannedStateBlock, report }
}

describe('buildStateReport', () => {
  it('records the emitted values, not the applied ones', () => {
    const report = buildStateReport({
      layer: 'piggyback_tagged_block',
      turn: planned({ currentLocation: 'item_sword', worldTimeDelta: -600 }),
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
      turn: planned({ worldTimeDelta: -600 }),
      failures: [],
      applied: {
        worldTimeDelta: 0,
        currentLocationRejected: false,
        drops: [],
        conditionsRejected: [],
        seatedDisabled: [],
      },
    })
    expect(report?.worldTimeDelta).toBe(-600)
    expect(report?.worldTimeDeltaApplied).toBe(0)
  })

  it('records the disabled rows the scene seats, and leaves the field off when there are none', () => {
    const report = (seatedDisabled: string[]) =>
      buildStateReport({
        layer: 'per_turn_classifier',
        turn: planned({ sceneEntities: ['char_spy'], currentLocation: 'loc_lair' }),
        failures: [],
        applied: {
          worldTimeDelta: 0,
          currentLocationRejected: false,
          drops: [],
          conditionsRejected: [],
          seatedDisabled,
        },
      })
    expect(report(['loc_lair', 'char_spy'])?.seatedDisabled).toEqual(['loc_lair', 'char_spy'])
    expect(report([])).not.toHaveProperty('seatedDisabled')
  })

  describe('dropped refs', () => {
    const dropped = {
      field: 'transfers',
      reason: 'unreadable',
      detail: 'transfers.items: slot: Invalid option',
    } as const

    it("records the fallback's, even in a report that holds nothing else", () => {
      expect(
        buildStateReport({
          layer: 'per_turn_classifier',
          turn: planned({}),
          failures: [],
          droppedRefs: [dropped],
        }),
      ).toEqual({ layer: 'per_turn_classifier', droppedRefs: [dropped] })
    })

    // data-model.md → Entry metadata shape: never the narrative's, which fails a field instead.
    it("are refused on the narrative's layer", () => {
      const narrative = {
        layer: 'piggyback_tagged_block' as const,
        turn: planned({}),
        failures: [],
      }
      // @ts-expect-error the narrative fold fails a field rather than dropping an entry
      const report = buildStateReport({ ...narrative, droppedRefs: [dropped] })
      expect(report?.layer).toBe('piggyback_tagged_block')
    })
  })

  // The headroom clamp is the case `worldTimeDelta < 0` never caught: a positive
  // emitted value that apply.ts still had to truncate.
  it('records a headroom clamp, which the emitted value alone cannot reveal', () => {
    const report = buildStateReport({
      layer: 'piggyback_tagged_block',
      turn: planned({ worldTimeDelta: 9_000_000 }),
      failures: [],
      applied: {
        worldTimeDelta: 120,
        currentLocationRejected: false,
        drops: [],
        conditionsRejected: [],
        seatedDisabled: [],
      },
    })
    expect(report?.worldTimeDelta).toBe(9_000_000)
    expect(report?.worldTimeDeltaApplied).toBe(120)
  })

  it('flags a rejected location only when apply.ts rejected it', () => {
    const rejected = buildStateReport({
      layer: 'piggyback_tagged_block',
      turn: planned({ currentLocation: 'item_sword' }),
      failures: [],
      applied: {
        worldTimeDelta: 0,
        currentLocationRejected: true,
        drops: [],
        conditionsRejected: [],
        seatedDisabled: [],
      },
    })
    expect(rejected?.currentLocationRejected).toBe(true)

    // An accepted location must leave the key absent: the panel keys its strikethrough
    // off presence, and a later user edit must not be able to manufacture one.
    const accepted = buildStateReport({
      layer: 'piggyback_tagged_block',
      turn: planned({ currentLocation: 'loc_keep' }),
      failures: [],
      applied: {
        worldTimeDelta: 0,
        currentLocationRejected: false,
        drops: [],
        conditionsRejected: [],
        seatedDisabled: [],
      },
    })
    expect(accepted).not.toHaveProperty('currentLocationRejected')
  })

  // Rows written before this field existed, and turns where nothing was applied.
  it('omits the applied delta when no apply outcome is supplied', () => {
    const report = buildStateReport({
      layer: 'per_turn_classifier',
      turn: planned({ worldTimeDelta: 30 }),
      failures: [],
    })
    expect(report?.worldTimeDelta).toBe(30)
    expect(report).not.toHaveProperty('worldTimeDeltaApplied')
  })

  it('omits raw and failedFields on a clean parse', () => {
    const report = buildStateReport({
      layer: 'piggyback_tagged_block',
      turn: planned({ sceneEntities: ['char_a'] }),
      failures: [],
      raw: '<state><scene_entities>char_a</scene_entities></state>',
    })
    expect(report).toEqual({ layer: 'piggyback_tagged_block', sceneEntities: ['char_a'] })
  })

  it('keeps raw and failedFields when a field failed', () => {
    const report = buildStateReport({
      layer: 'piggyback_tagged_block',
      turn: planned({ sceneEntities: ['char_a'] }),
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
      turn: planned({}),
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
      turn: planned({ summary: 'A sentence.' }),
      failures: [],
      applied: {
        worldTimeDelta: 0,
        currentLocationRejected: false,
        drops: [],
        conditionsRejected: [],
        seatedDisabled: [],
      },
    })
    expect(report).toEqual({ layer: 'piggyback_tagged_block' })
  })

  it('returns undefined when no block was found and nothing failed', () => {
    expect(
      buildStateReport({ layer: 'piggyback_tagged_block', turn: planned({}), failures: [] }),
    ).toBeUndefined()
  })

  // summary already has a top-level home on EntryMetadata; duplicating it into the
  // report would give the reader two sources for one sentence.
  it('does not copy summary into the report', () => {
    const report = buildStateReport({
      layer: 'piggyback_tagged_block',
      turn: planned({ summary: 'A sentence.', sceneEntities: [] }),
      failures: [],
    })
    expect(report).not.toHaveProperty('summary')
  })

  // Pins the full allowlisted shape, not absence: `not.toHaveProperty(...)` would pass before
  // any change (vacuous). Asserting the whole object fails once the return becomes `...block`.
  it('reports exactly the allowlisted keys, excluding summary and retrievalQueries', () => {
    const report = buildStateReport({
      layer: 'piggyback_tagged_block',
      turn: planned({ sceneEntities: ['char_a'], summary: 's', retrievalQueries: ['q'] }),
      failures: [],
    })
    expect(report).toEqual({ layer: 'piggyback_tagged_block', sceneEntities: ['char_a'] })
  })

  // Judged on the block as emitted: a block carrying only retrieval asks still reports state —
  // suppressing it would badge the turn as one where piggyback never ran.
  it('still reports a block that carried only retrieval asks', () => {
    const report = buildStateReport({
      layer: 'piggyback_tagged_block',
      turn: planned({ retrievalQueries: ['q'] }),
      failures: [],
    })
    expect(report?.layer).toBe('piggyback_tagged_block')
  })

  it('carries the full transfer and visual-change shapes through', () => {
    const report = buildStateReport({
      layer: 'piggyback_tagged_block',
      turn: planned({
        visualChanges: [{ id: 'char_a', type: 'attire', text: 'muddied cloak' }],
        transfers: {
          items: [{ id: 'item_a', slot: 'inventory', to: 'char_a', from: 'char_b', seq: 0 }],
          stackables: [{ key: 'gold', amount: 50, to: 'char_a' }],
          drops: [],
        },
      }),
      failures: [],
    })
    expect(report?.visualChanges).toEqual([{ id: 'char_a', type: 'attire', text: 'muddied cloak' }])
    expect(report?.transfers?.items[0]?.from).toBe('char_b')
    expect(report?.transfers?.stackables[0]?.key).toBe('gold')
  })

  // data-model.md → Entry metadata shape.
  it('reports item moves without the order the block carried', () => {
    const report = buildStateReport({
      layer: 'piggyback_tagged_block',
      turn: planned({
        transfers: {
          items: [{ id: 'item_a', slot: 'inventory', to: 'char_a', seq: 0 }],
          stackables: [{ key: 'gold', amount: 5, to: 'char_a' }],
          drops: [],
        },
      }),
      failures: [],
    })
    expect(report?.transfers).toEqual({
      items: [{ id: 'item_a', slot: 'inventory', to: 'char_a' }],
      stackables: [{ key: 'gold', amount: 5, to: 'char_a' }],
    })
  })
})

describe("buildStateReport with this turn's creates", () => {
  const docks: NewLocationReport = {
    handle: 'new:docks',
    name: 'the Docks',
    description: 'a rotting pier',
    parent: 'loc_town',
    outcome: 'created',
    id: 'loc_docks',
  }
  const apple: NewItemReport = {
    handle: 'new:apple',
    name: 'apple',
    description: 'eaten on the spot',
    outcome: 'dropped',
  }

  it("records both lists beside the block's resolved fields", () => {
    const report = buildStateReport({
      layer: 'piggyback_tagged_block',
      turn: planned({ currentLocation: 'loc_docks' }, { newLocations: [docks], newItems: [apple] }),
      failures: [],
    })
    expect(report).toEqual({
      layer: 'piggyback_tagged_block',
      currentLocation: 'loc_docks',
      newLocations: [docks],
      newItems: [apple],
    })
  })

  it('omits an empty list', () => {
    const report = buildStateReport({
      layer: 'piggyback_tagged_block',
      turn: planned({ currentLocation: 'loc_docks' }, { newLocations: [docks], newItems: [] }),
      failures: [],
    })
    expect(report).toEqual({
      layer: 'piggyback_tagged_block',
      currentLocation: 'loc_docks',
      newLocations: [docks],
    })
  })

  // The planner strips create lists from the block, so the lists alone must still report.
  it('reports a block that carried only creates', () => {
    const report = buildStateReport({
      layer: 'per_turn_classifier',
      turn: planned({}, { newLocations: [], newItems: [apple] }),
      failures: [],
    })
    expect(report).toEqual({ layer: 'per_turn_classifier', newItems: [apple] })
  })

  it('returns undefined when the block and both lists are empty', () => {
    expect(
      buildStateReport({
        layer: 'piggyback_tagged_block',
        turn: planned({}, { newLocations: [], newItems: [] }),
        failures: [],
      }),
    ).toBeUndefined()
  })

  // The planner mints the block and resolves or removes every create, so the lists come only
  // from the report.
  it('takes only a planned block, which carries no create lists', () => {
    const { block } = planned({ sceneEntities: ['char_a'] })
    // @ts-expect-error a hand-built block was never planned
    const handBuilt: PlannedStateBlock = { sceneEntities: ['char_a'] }
    // @ts-expect-error a planned block carries no create lists
    const relisted: PlannedStateBlock = { ...block, newItems: [] }
    const report = () =>
      buildStateReport({
        layer: 'piggyback_tagged_block',
        // @ts-expect-error nor does the report take one
        turn: { block: { sceneEntities: ['char_a'] }, report: NO_CREATES },
        failures: [],
      })
    expect([handBuilt, relisted, report]).toHaveLength(3)
  })
})

// data-model.md → Entry metadata shape.
describe('buildStateReport — conditions and drops', () => {
  it('reports conditions as emitted', () => {
    const report = buildStateReport({
      layer: 'piggyback_tagged_block',
      turn: planned({ conditions: [{ id: 'loc_a', text: 'burned to the ground' }] }),
      failures: [],
    })
    expect(report).toEqual({
      layer: 'piggyback_tagged_block',
      conditions: [{ id: 'loc_a', text: 'burned to the ground' }],
    })
  })

  // Positions, not ids: the same place can be conditioned twice in one block.
  it('marks each condition apply.ts refused, by its position, keeping text and order', () => {
    const report = buildStateReport({
      layer: 'piggyback_tagged_block',
      turn: planned({
        conditions: [
          { id: 'loc_a', text: '' },
          { id: 'loc_a', text: 'burned to the ground' },
          { id: 'loc_b', text: 'flooded to the knee' },
        ],
      }),
      failures: [],
      applied: {
        worldTimeDelta: 0,
        currentLocationRejected: false,
        drops: [],
        conditionsRejected: [0, 2],
        seatedDisabled: [],
      },
    })
    expect(report?.conditions).toEqual([
      { id: 'loc_a', text: '', rejected: true },
      { id: 'loc_a', text: 'burned to the ground' },
      { id: 'loc_b', text: 'flooded to the knee', rejected: true },
    ])
  })

  it("reports the drops apply.ts applied, where they landed, never the block's own", () => {
    const report = buildStateReport({
      layer: 'piggyback_tagged_block',
      turn: planned({
        transfers: {
          items: [],
          stackables: [],
          drops: [
            { id: 'item_a', from: 'char_a', seq: 0 },
            { id: 'item_b', seq: 1 },
          ],
        },
      }),
      failures: [],
      applied: {
        worldTimeDelta: 0,
        currentLocationRejected: false,
        drops: [{ id: 'item_a', from: 'char_a', at: 'loc_a' }],
        conditionsRejected: [],
        seatedDisabled: [],
      },
    })
    expect(report?.transfers).toEqual({
      items: [],
      stackables: [],
      drops: [{ id: 'item_a', from: 'char_a', at: 'loc_a' }],
    })
  })

  it('leaves drops out of the report when none was applied', () => {
    const report = buildStateReport({
      layer: 'piggyback_tagged_block',
      turn: planned({
        transfers: { items: [], stackables: [], drops: [{ id: 'item_b', seq: 0 }] },
      }),
      failures: [],
      applied: {
        worldTimeDelta: 0,
        currentLocationRejected: false,
        drops: [],
        conditionsRejected: [],
        seatedDisabled: [],
      },
    })
    expect(report?.transfers).toEqual({ items: [], stackables: [] })
  })
})
