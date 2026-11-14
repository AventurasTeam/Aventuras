import { describe, expect, it } from 'vitest'

import type { EntityKind } from '@/lib/db'

import { reviewRowHref, type ReviewRowLiveness } from './review-row-href'

const LIVE = new Set([
  'lore:lore_tithe',
  'entities:ent_kael',
  'entities:ent_gate',
  'entities:ent_unknown_kind',
  'threads:thr_keep',
  'happenings:hap_fire',
  'happening_awareness:aw_kael_fire',
  'happening_awareness:aw_orphan',
  'happening_awareness:aw_unlinked',
  'character_relationships:rel_kael_mira',
])
const KINDS = new Map<string, EntityKind>([
  ['ent_kael', 'character'],
  ['ent_gate', 'location'],
  // A kind lookup that outlives its row: liveness alone keeps this deleted entity from pressing.
  ['ent_deleted', 'faction'],
])
const AWARENESS_HAPPENING = new Map([
  ['aw_kael_fire', 'hap_fire'],
  ['aw_orphan', 'hap_deleted'],
  ['aw_deleted', 'hap_fire'],
])

const live: ReviewRowLiveness = {
  isLive: (table, id) => LIVE.has(`${table}:${id}`),
  entityKind: (id) => KINDS.get(id),
  awarenessHappening: (id) => AWARENESS_HAPPENING.get(id),
}

describe('reviewRowHref', () => {
  it('opens lore and entities in World, by lore or the entity kind', () => {
    expect(reviewRowHref('br_1', { table: 'lore', id: 'lore_tithe' }, live)).toBe(
      '/world/br_1?kind=lore&id=lore_tithe',
    )
    expect(reviewRowHref('br_1', { table: 'entities', id: 'ent_kael' }, live)).toBe(
      '/world/br_1?kind=character&id=ent_kael',
    )
    expect(reviewRowHref('br_1', { table: 'entities', id: 'ent_gate' }, live)).toBe(
      '/world/br_1?kind=location&id=ent_gate',
    )
  })

  it('opens threads and happenings in Plot', () => {
    expect(reviewRowHref('br_1', { table: 'threads', id: 'thr_keep' }, live)).toBe(
      '/plot/br_1?kind=thread&id=thr_keep',
    )
    expect(reviewRowHref('br_1', { table: 'happenings', id: 'hap_fire' }, live)).toBe(
      '/plot/br_1?kind=happening&id=hap_fire',
    )
  })

  it("opens an awareness row on its happening's Awareness tab", () => {
    expect(reviewRowHref('br_1', { table: 'happening_awareness', id: 'aw_kael_fire' }, live)).toBe(
      '/plot/br_1?kind=happening&id=hap_fire&tab=awareness',
    )
  })

  it('routes whatever pressTo names, never the absorbed target', () => {
    // closeReviewChanges gives an absorbed row the survivor as pressTo; the absorbed row is gone.
    const absorbed = {
      target: { table: 'threads', id: 'thr_absorbed' },
      pressTo: { table: 'threads', id: 'thr_keep' },
    }
    expect(reviewRowHref('br_1', absorbed.target, live)).toBeNull()
    expect(reviewRowHref('br_1', absorbed.pressTo, live)).toBe('/plot/br_1?kind=thread&id=thr_keep')
  })

  it('gives no href for a target or survivor gone from its store', () => {
    expect(reviewRowHref('br_1', { table: 'lore', id: 'lore_deleted' }, live)).toBeNull()
    expect(reviewRowHref('br_1', { table: 'entities', id: 'ent_deleted' }, live)).toBeNull()
    expect(reviewRowHref('br_1', { table: 'happenings', id: 'hap_deleted' }, live)).toBeNull()
    expect(
      reviewRowHref('br_1', { table: 'happening_awareness', id: 'aw_deleted' }, live),
    ).toBeNull()
    // A survivor a later merge absorbed is gone too: the chain isn't followed.
    expect(reviewRowHref('br_1', { table: 'threads', id: 'thr_absorbed_later' }, live)).toBeNull()
  })

  it('gives no href for a row with nothing to press to, as a refused create_lore', () => {
    expect(reviewRowHref('br_1', null, live)).toBeNull()
  })

  it('gives no href for an awareness row whose happening is gone or unknown', () => {
    expect(
      reviewRowHref('br_1', { table: 'happening_awareness', id: 'aw_orphan' }, live),
    ).toBeNull()
    expect(
      reviewRowHref('br_1', { table: 'happening_awareness', id: 'aw_unlinked' }, live),
    ).toBeNull()
  })

  it('gives no href for a live entity of unknown kind, or a table with no pane', () => {
    expect(reviewRowHref('br_1', { table: 'entities', id: 'ent_unknown_kind' }, live)).toBeNull()
    expect(
      reviewRowHref('br_1', { table: 'character_relationships', id: 'rel_kael_mira' }, live),
    ).toBeNull()
  })
})
