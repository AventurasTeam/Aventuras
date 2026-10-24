import { describe, expect, it } from 'vitest'

import { parseStateBlock } from '@/lib/piggyback'

import { NARRATIVE_LANE } from './routing'
import { validateLaneValue } from './validate'

const narrative = (state: Record<string, unknown>) =>
  validateLaneValue(NARRATIVE_LANE, { prose: 'Rain on the docks.', state })

// The renderer reads every field validate.ts accepts, so one it can't render is refused here.
describe('validateLaneValue — a narrative state block', () => {
  it('accepts a create with no description, as the app reads one', () => {
    expect(
      narrative({
        newLocations: [{ handle: 'new:docks', name: 'the docks', parent: 'l1' }],
        newItems: [{ handle: 'new:key', name: 'key', condition: 'bent' }],
      }),
    ).toEqual({ ok: true })
  })

  it.each([
    ['a location with no name', { newLocations: [{ handle: 'new:docks' }] }],
    ['an item with no handle', { newItems: [{ name: 'key' }] }],
    ['a condition with no text', { conditions: [{ id: 'l1' }] }],
    ['a query that is no string', { retrievalQueries: [5] }],
    ['a drop with no id', { transfers: { items: [], stackables: [], drops: [{ from: 'c1' }] } }],
  ])('refuses %s', (_label, state) => {
    expect(narrative(state)).toMatchObject({ ok: false })
  })

  // "Save reply as response" stores the parsed block, its moves numbered.
  it('accepts a block parsed back from a served reply', () => {
    const { block } = parseStateBlock(`<state>
  <new_location handle="new:docks" name="the docks">a pier</new_location>
  <current_location>new:docks</current_location>
  <conditions><entity id="l1">flooded</entity></conditions>
  <transfers>
    <item id="i1" to="c1" slot="inventory" />
    <drop id="i2" from="c1" />
  </transfers>
  <retrieval_queries><query>the docks</query></retrieval_queries>
</state>`)
    expect(narrative(block)).toEqual({ ok: true })
  })
})
