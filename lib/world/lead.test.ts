import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Entity } from '@/lib/db'
import { logger } from '@/lib/diagnostics'

import { leadLabelFor, needsLead, resolveLead, resolveLeadLogged } from './lead'

const row = (id: string, over: Partial<Entity> = {}) =>
  ({ id, branchId: 'b1', kind: 'character', status: 'active', isLead: 0, ...over }) as Entity

const rowsOf = (...rows: Entity[]) => new Map(rows.map((r) => [r.id, r]))

type Read = (rows: ReadonlyMap<string, Entity>, branchId: string) => Entity | null

const READS: [string, Read][] = [
  ['resolveLead', (rows, branchId) => resolveLead(rows, branchId)],
  ['resolveLeadLogged', (rows, branchId) => resolveLeadLogged(rows, branchId, 'lead.test')],
]

afterEach(() => {
  vi.restoreAllMocks()
})

describe.each(READS)('%s', (_name, read) => {
  it("returns the branch's one flagged character", () => {
    const kael = row('char_kael', { isLead: 1 })
    expect(read(rowsOf(row('char_mira'), kael), 'b1')).toBe(kael)
  })

  it('returns null when no row carries the flag', () => {
    expect(read(rowsOf(row('char_kael'), row('char_mira')), 'b1')).toBeNull()
  })

  it('returns null with two flagged rows', () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    const double = rowsOf(row('char_kael', { isLead: 1 }), row('char_mira', { isLead: 1 }))
    expect(read(double, 'b1')).toBeNull()
  })

  // data-model.md → The lead: a lead retired or staged stays the lead; only setting one needs active.
  it.each(['retired', 'staged'] as const)('keeps a %s flagged character as the lead', (status) => {
    const kael = row('char_kael', { isLead: 1, status })
    expect(read(rowsOf(kael), 'b1')).toBe(kael)
  })

  it('counts no flag on another branch, or on a row that is no character', () => {
    const kael = row('char_kael', { isLead: 1 })
    const elsewhere = row('char_mira', { isLead: 1, branchId: 'b2' })
    const place = row('loc_keep', { isLead: 1, kind: 'location' })
    expect(read(rowsOf(kael, elsewhere, place), 'b1')).toBe(kael)
    expect(read(rowsOf(elsewhere), 'b1')).toBeNull()
    expect(read(rowsOf(place), 'b1')).toBeNull()
  })
})

// data-model.md → The lead: a redo reapplies a set one store patch at a time, so a render path
// sees two flags between patches of a correct redo; only the actions and pipelines log a double.
describe('a double', () => {
  const double = () => rowsOf(row('char_kael', { isLead: 1 }), row('char_mira', { isLead: 1 }))

  it('logs nothing from the render-path read', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    resolveLead(double(), 'b1')
    expect(error).not.toHaveBeenCalled()
  })

  it('logs once per logging read, naming its site, the branch and every flagged id', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const triple = rowsOf(
      row('char_kael', { isLead: 1 }),
      row('char_mira', { isLead: 1 }),
      row('char_ivo', { isLead: 1 }),
    )

    resolveLeadLogged(triple, 'b1', 'generation-context')
    resolveLeadLogged(triple, 'b1', 'generation-context')

    expect(error).toHaveBeenCalledTimes(2)
    expect(error).toHaveBeenNthCalledWith(1, 'pipeline.lead_double', {
      site: 'generation-context',
      branchId: 'b1',
      ids: ['char_kael', 'char_mira', 'char_ivo'],
    })
  })

  it('logs nothing from the logging read with one lead or none', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    resolveLeadLogged(rowsOf(row('char_kael', { isLead: 1 })), 'b1', 'lead.test')
    resolveLeadLogged(rowsOf(row('char_kael')), 'b1', 'lead.test')
    expect(error).not.toHaveBeenCalled()
  })
})

// principles.md → Mode, lead, and narration: either adventure or a first or second person is enough.
describe('needsLead', () => {
  it.each([
    ['adventure', 'first', true],
    ['adventure', 'second', true],
    ['adventure', 'third', true],
    ['creative', 'first', true],
    ['creative', 'second', true],
    ['creative', 'third', false],
  ] as const)('%s told in the %s person: %s', (mode, narration, needed) => {
    expect(needsLead(mode, narration)).toBe(needed)
  })
})

describe('leadLabelFor', () => {
  it('labels the lead `you` in adventure and `protagonist` in creative', () => {
    expect(leadLabelFor('adventure')).toBe('you')
    expect(leadLabelFor('creative')).toBe('protagonist')
  })
})
