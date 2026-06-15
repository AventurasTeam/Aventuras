import { describe, expect, it } from 'vitest'

import { TEMPLATE_IDS } from './ids'
import { TEMPLATE_GROUPS, validateRegistry } from './templateContextMap'

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
})
