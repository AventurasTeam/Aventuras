import { describe, expect, it } from 'vitest'

import type { Entity } from '@/lib/db'

import { resolveLead } from './lead'

const row = (id: string, branchId: string, kind: Entity['kind']) =>
  ({ id, branchId, kind }) as Entity

describe('resolveLead', () => {
  const rows = new Map<string, Entity>([
    ['char_1', row('char_1', 'b1', 'character')],
    ['loc_1', row('loc_1', 'b1', 'location')],
  ])

  it('returns the lead character on this branch', () => {
    expect(resolveLead('char_1', rows, 'b1')?.id).toBe('char_1')
  })

  it('returns null for no lead, a dangling id, another branch, or a non-character', () => {
    expect(resolveLead(null, rows, 'b1')).toBeNull()
    expect(resolveLead('char_gone', rows, 'b1')).toBeNull()
    expect(resolveLead('char_1', rows, 'b2')).toBeNull()
    expect(resolveLead('loc_1', rows, 'b1')).toBeNull()
  })
})
