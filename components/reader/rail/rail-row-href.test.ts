import { describe, expect, it } from 'vitest'

import { railRowHref } from './rail-row-href'

describe('railRowHref', () => {
  it('routes World rows to World with the row pre-selected', () => {
    expect(railRowHref('br_1', 'location', 'loc_1')).toBe('/world/br_1?kind=location&id=loc_1')
    expect(railRowHref('br_1', 'lore', 'lore_1')).toBe('/world/br_1?kind=lore&id=lore_1')
  })

  it('routes Plot rows to Plot with the row pre-selected', () => {
    expect(railRowHref('br_1', 'thread', 't_1')).toBe('/plot/br_1?kind=thread&id=t_1')
    expect(railRowHref('br_1', 'happening', 'h_1')).toBe('/plot/br_1?kind=happening&id=h_1')
  })
})
