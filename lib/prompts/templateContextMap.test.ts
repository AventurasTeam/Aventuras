import { describe, expect, it } from 'vitest'

import { TEMPLATE_IDS } from './ids'
import {
  DISPLAY_GROUPS,
  TEMPLATE_GROUPS,
  VARIABLES,
  validateRegistry,
  type VariableDef,
} from './templateContextMap'

const ALL_VARIABLES = Object.values(VARIABLES).flat()

// validateRegistry only walks display groups toward variables, leaving both
// reverse directions unchecked: a defined variable in no group, and a
// `category` naming no group. DISPLAY_GROUPS and `category` are two
// hand-maintained copies of one grouping with nothing tying them together.
const ungroupedNames = (defs: readonly VariableDef[]) => {
  const grouped = new Set(Object.values(DISPLAY_GROUPS).flat())
  return defs.filter((v) => !grouped.has(v.name)).map((v) => v.name)
}

const strayCategories = (defs: readonly VariableDef[]) => {
  const groups = new Set(Object.keys(DISPLAY_GROUPS))
  return defs.filter((v) => !groups.has(v.category)).map((v) => `${v.name} -> ${v.category}`)
}

// Positive control for both checks above: one variable that is wrong in both
// directions at once, so neither assertion can pass by finding nothing to look at.
const GHOST: VariableDef = {
  name: 'ghostVariable',
  type: 'string',
  category: 'Bogus Group That Does Not Exist',
  description: 'Defined nowhere, grouped nowhere.',
}

describe('templateContextMap', () => {
  it('maps every shipped template id to a group', () => {
    for (const id of Object.values(TEMPLATE_IDS)) {
      expect(TEMPLATE_GROUPS[id]).toBeDefined()
    }
  })

  it('passes integrity validation on the shipped registry', () => {
    expect(validateRegistry(Object.values(TEMPLATE_IDS))).toEqual([])
  })

  it('reports an unmapped template id', () => {
    const issues = validateRegistry([...Object.values(TEMPLATE_IDS), 'tmpl_ghost'])
    expect(issues).toContainEqual({ kind: 'unmapped-template', id: 'tmpl_ghost' })
  })

  it('surfaces every defined variable in some display group', () => {
    expect(ungroupedNames(ALL_VARIABLES)).toEqual([])
    expect(ungroupedNames([GHOST])).toEqual(['ghostVariable'])
  })

  it('gives every variable a category that names a display group', () => {
    expect(strayCategories(ALL_VARIABLES)).toEqual([])
    expect(strayCategories([GHOST])).toEqual(['ghostVariable -> Bogus Group That Does Not Exist'])
  })

  it('reports a dangling display variable', () => {
    const issues = validateRegistry(Object.values(TEMPLATE_IDS), { Bogus: ['nonexistent_var'] })
    expect(issues).toContainEqual({
      kind: 'dangling-display-variable',
      displayGroup: 'Bogus',
      name: 'nonexistent_var',
    })
  })
})
