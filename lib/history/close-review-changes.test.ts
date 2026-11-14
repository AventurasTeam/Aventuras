import { describe, expect, it } from 'vitest'

import type { CloseReport, CloseReportCall, Delta, EntityKind } from '@/lib/db'

import { closeReviewChanges } from './close-review-changes'
import type { CloseReviewLookup } from './close-review-types'

const KAEL = { table: 'entities', id: 'char_kael', name: 'Kael' }
const ORDER = { table: 'entities', id: 'fact_order', name: 'The Order' }
const QUAY = { table: 'entities', id: 'loc_quay', name: 'The Quay' }
const LAMP = { table: 'entities', id: 'item_lamp', name: 'The Lamp' }
const GONE = { table: 'entities', id: 'loc_gone', name: 'The Old Mill' }
const TITHE = { table: 'lore', id: 'lore_tithe', name: 'The Tithe of Hours' }
const LETTER = { table: 'threads', id: 'thr_letter', name: 'The letter' }
const SEAL = { table: 'threads', id: 'thr_seal', name: 'The seal' }
const FIRE = { table: 'happenings', id: 'hap_fire', name: 'The fire' }
const AWARE = { table: 'happening_awareness', id: 'haw_kael_fire', name: '' }

const KINDS = new Map<string, EntityKind>([
  ['char_kael', 'character'],
  ['fact_order', 'faction'],
  ['loc_quay', 'location'],
  ['item_lamp', 'item'],
  ['loc_gone', 'location'],
])
const NAMES = new Map([
  ['loc_harbour', 'The Harbour'],
  ['char_kael', 'Kael today'],
])
const POSITIONS = new Map([
  ['entry_110', 110],
  ['entry_112', 112],
  ['entry_118', 118],
])

const LOOKUP: CloseReviewLookup = {
  entityKind: (id) => KINDS.get(id),
  nameOf: (id) => NAMES.get(id),
  entryPosition: (id) => POSITIONS.get(id),
}

function call(fields: Partial<CloseReportCall> & Pick<CloseReportCall, 'tool'>): CloseReportCall {
  return {
    task: 'identity',
    part: 1,
    rows: [],
    why: 'Because the chapter says so.',
    turns: ['entry_112'],
    result: 'ok',
    ...fields,
  }
}

function report(calls: CloseReportCall[]): CloseReport {
  return { version: 1, actionId: 'act_close', calls, stopped: [], noToolCalls: false }
}

let position = 0
function delta(
  row: { table: string; id: string },
  undoPayload: Record<string, unknown> | null,
  op: Delta['op'] = 'update',
): Delta {
  position += 1
  return {
    id: `delta_${position}`,
    branchId: 'br_1',
    entryId: 'entry_118',
    actionId: 'act_close',
    logPosition: position,
    source: 'chapter_close',
    targetTable: row.table,
    targetId: row.id,
    op,
    undoPayload,
    encodingVersion: 1,
    createdAt: position,
  }
}

const summaries = (changes: ReturnType<typeof closeReviewChanges>) =>
  changes.flatMap(({ area, rows }) => rows.map((row) => [area, row.target.name, row.summary]))

describe('closeReviewChanges', () => {
  it("groups rows by area in canon's order, entities by kind, rows in run order inside an area", () => {
    const calls = [
      call({ tool: 'mark_common_knowledge', rows: [FIRE], values: { commonKnowledge: '1' } }),
      call({ tool: 'update_item', rows: [LAMP], values: { 'state.condition': 'Cracked' } }),
      call({ tool: 'update_faction', rows: [ORDER], values: { 'state.standing': 'Broken' } }),
      call({ tool: 'update_thread', rows: [LETTER], values: { status: 'resolved' } }),
      call({ tool: 'set_pin', rows: [AWARE], values: { decayResistance: '0.9' } }),
      call({ tool: 'update_place', rows: [QUAY], values: { 'state.condition': 'Flooded' } }),
      call({ tool: 'update_character', rows: [KAEL], values: { 'state.voice': 'Flat' } }),
      call({
        tool: 'create_lore',
        rows: [TITHE],
        values: { title: 'The Tithe', body: 'An hour.' },
      }),
    ]

    const changes = closeReviewChanges(report(calls), [], LOOKUP)

    expect(changes.map(({ area }) => area)).toEqual([
      'lore',
      'charactersAndFactions',
      'placesAndItems',
      'threads',
      'happenings',
      'awareness',
    ])
    expect(summaries(changes)).toEqual([
      ['lore', 'The Tithe of Hours', 'An hour.'],
      ['charactersAndFactions', 'The Order', 'Broken'],
      ['charactersAndFactions', 'Kael', 'Flat'],
      ['placesAndItems', 'The Lamp', 'Cracked'],
      ['placesAndItems', 'The Quay', 'Flooded'],
      ['threads', 'The letter', 'resolved'],
      ['happenings', 'The fire', 'Yes'],
      ['awareness', 'Awareness', '0.9'],
    ])
  })

  it('keeps a deleted entity in its area by the kind the lookup gives, and an unknown kind with characters', () => {
    const calls = [
      call({ tool: 'update_place', rows: [GONE], values: { description: 'Ash.' } }),
      call({
        tool: 'update_character',
        rows: [{ table: 'entities', id: 'char_lost', name: 'Bram' }],
        values: { description: 'Gone.' },
      }),
    ]

    const changes = closeReviewChanges(report(calls), [], LOOKUP)

    expect(summaries(changes)).toEqual([
      ['charactersAndFactions', 'Bram', 'Gone.'],
      ['placesAndItems', 'The Old Mill', 'Ash.'],
    ])
  })

  it('leaves out an area with no row, and a table no area holds', () => {
    const calls = [
      call({ tool: 'update_character', rows: [KAEL], values: { 'state.voice': 'Flat' } }),
      call({
        tool: 'set_role',
        rows: [{ table: 'happening_involvements', id: 'hinv_1', name: 'Kael' }],
        values: { role: 'witness' },
      }),
    ]

    expect(closeReviewChanges(report(calls), [], LOOKUP).map(({ area }) => area)).toEqual([
      'charactersAndFactions',
    ])
  })

  it('reads the old value from the delta and the new one from the report, field by field', () => {
    const calls = [
      call({
        tool: 'update_character',
        rows: [KAEL],
        values: {
          'state.voice': 'short, flat sentences',
          description: 'A ranger who stopped joking.',
        },
        turns: ['entry_118', 'entry_112'],
      }),
    ]
    const deltas = [delta(KAEL, { state: { voice: 'wry, joking' }, description: 'A ranger.' })]

    const [area] = closeReviewChanges(report(calls), deltas, LOOKUP)

    expect(area!.rows).toEqual([
      {
        key: '0:entities:char_kael:state.voice',
        op: 'update',
        area: 'charactersAndFactions',
        target: KAEL,
        fieldPath: 'state.voice',
        fieldLabel: 'Voice',
        summary: 'wry, joking → short, flat sentences',
        why: 'Because the chapter says so.',
        entryId: 'entry_118',
        pressTo: { table: 'entities', id: 'char_kael' },
      },
      {
        key: '0:entities:char_kael:description',
        op: 'update',
        area: 'charactersAndFactions',
        target: KAEL,
        fieldPath: 'description',
        fieldLabel: 'Description',
        summary: 'A ranger. → A ranger who stopped joking.',
        why: 'Because the chapter says so.',
        entryId: 'entry_118',
        pressTo: { table: 'entities', id: 'char_kael' },
      },
    ])
  })

  it('pairs a field two parts wrote each with its own delta', () => {
    const calls = [
      call({
        tool: 'update_character',
        part: 1,
        rows: [KAEL],
        values: { 'state.voice': 'Quieter' },
      }),
      call({
        tool: 'update_character',
        part: 2,
        rows: [KAEL],
        values: { 'state.voice': 'Silent' },
      }),
    ]
    const deltas = [
      delta(KAEL, { state: { voice: 'Loud' } }),
      delta(KAEL, { state: { voice: 'Quieter' } }),
    ]

    const [area] = closeReviewChanges(report(calls), deltas, LOOKUP)

    expect(area!.rows.map(({ summary }) => summary)).toEqual(['Loud → Quieter', 'Quieter → Silent'])
  })

  it('shows the new value alone where no delta names the field, or the old value was empty', () => {
    const calls = [
      call({
        tool: 'update_character',
        rows: [KAEL],
        values: { 'state.voice': 'Flat', description: 'A ranger.' },
      }),
      call({ tool: 'update_place', rows: [QUAY], values: { 'state.condition': 'Flooded' } }),
    ]
    const deltas = [delta(KAEL, { description: '' }), delta(QUAY, { state: { condition: null } })]

    const changes = closeReviewChanges(report(calls), deltas, LOOKUP)

    expect(summaries(changes).map(([, , summary]) => summary)).toEqual([
      'Flat',
      'A ranger.',
      'Flooded',
    ])
  })

  it('renders an old list, row id and entry id as text', () => {
    const calls = [
      call({ tool: 'update_character', rows: [KAEL], values: { 'state.traits': 'patient' } }),
      call({
        tool: 'update_place',
        rows: [QUAY],
        values: { 'state.parent_location_id': 'The Market' },
      }),
      call({ tool: 'update_thread', rows: [LETTER], values: { resolvedAtEntryId: 'entry #118' } }),
    ]
    const deltas = [
      delta(KAEL, { state: { traits: ['wary', 'proud'] } }),
      delta(QUAY, { state: { parent_location_id: 'loc_harbour' } }),
      delta(LETTER, { resolvedAtEntryId: 'entry_110' }),
    ]

    const changes = closeReviewChanges(report(calls), deltas, LOOKUP)

    expect(summaries(changes).map(([, , summary]) => summary)).toEqual([
      'wary, proud → patient',
      'The Harbour → The Market',
      'entry #110 → entry #118',
    ])
  })

  it('renders an old object as stored', () => {
    const calls = [call({ tool: 'update_happening', rows: [FIRE], values: { temporal: 'Dusk' } })]
    const deltas = [delta(FIRE, { temporal: { start: 1 } })]

    expect(summaries(closeReviewChanges(report(calls), deltas, LOOKUP))).toEqual([
      ['happenings', 'The fire', '{"start":1} → Dusk'],
    ])
  })

  it('reads a cleared value as none', () => {
    const calls = [call({ tool: 'set_keywords', rows: [KAEL], values: { keywords: '' } })]
    const deltas = [delta(KAEL, { keywords: ['harbour', 'quay'] })]

    expect(summaries(closeReviewChanges(report(calls), deltas, LOOKUP))).toEqual([
      ['charactersAndFactions', 'Kael', 'harbour, quay → none'],
    ])
  })

  it('reads an empty value as none when no old value pairs with it', () => {
    const calls = [call({ tool: 'set_keywords', rows: [KAEL], values: { keywords: '' } })]

    expect(summaries(closeReviewChanges(report(calls), [], LOOKUP))).toEqual([
      ['charactersAndFactions', 'Kael', 'none'],
    ])
  })

  it('names only the move on a top mark, not the unplaced flag it cleared', () => {
    const calls = [
      call({ tool: 'update_place', rows: [QUAY], values: { 'state.unplaced': 'top level' } }),
    ]
    const deltas = [delta(QUAY, { state: { unplaced: true } })]

    expect(summaries(closeReviewChanges(report(calls), deltas, LOOKUP))).toEqual([
      ['placesAndItems', 'The Quay', 'top level'],
    ])
  })

  it('reads common knowledge as no or yes, and keeps a zero old value elsewhere', () => {
    const calls = [
      call({ tool: 'mark_common_knowledge', rows: [FIRE], values: { commonKnowledge: '1' } }),
      call({ tool: 'set_pin', rows: [AWARE], values: { decayResistance: '0.9' } }),
    ]
    const deltas = [delta(FIRE, { commonKnowledge: 0 }), delta(AWARE, { decayResistance: 0 })]

    expect(summaries(closeReviewChanges(report(calls), deltas, LOOKUP))).toEqual([
      ['happenings', 'The fire', 'No → Yes'],
      ['awareness', 'Awareness', '0 → 0.9'],
    ])
  })

  it('reads 0.6 → 0.9 on an awareness row a merge took from 0.2 to 0.6 before set_pin', () => {
    const calls = [
      call({
        task: 'happenings',
        part: 0,
        tool: 'merge_happenings',
        rows: [FIRE, { table: 'happenings', id: 'hap_blaze', name: 'The blaze' }],
        survivor: { table: 'happenings', id: 'hap_fire' },
      }),
      call({
        task: 'awareness',
        part: 0,
        tool: 'set_pin',
        rows: [AWARE],
        values: { decayResistance: '0.9' },
      }),
    ]
    const deltas = [
      delta(AWARE, { decayResistance: 0.2 }),
      delta(
        { table: 'happenings', id: 'hap_blaze' },
        { id: 'hap_blaze', title: 'The blaze' },
        'delete',
      ),
      delta(AWARE, { decayResistance: 0.6 }),
    ]

    const changes = closeReviewChanges(report(calls), deltas, LOOKUP)

    expect(
      changes.find(({ area }) => area === 'awareness')!.rows.map(({ summary }) => summary),
    ).toEqual(['0.6 → 0.9'])
  })

  it('gives no row for stamps, resets, normalization, a read, a restated field or an empty ok call', () => {
    const calls = [
      call({ tool: 'read_row', rows: [KAEL], why: '', turns: [] }),
      call({ tool: 'update_character', rows: [KAEL], values: { description: 'A ranger.' } }),
      call({ tool: 'update_place', rows: [QUAY] }),
      call({
        tool: 'update_item',
        rows: [LAMP],
        values: { 'state.condition': 'Cracked' },
        skippedFields: [{ field: 'state.condition', reason: 'later-turn' }],
      }),
    ]
    const deltas = [
      delta({ table: 'story_entries', id: 'entry_112' }, { chapterId: null }),
      delta(AWARE, { retrievalCount: 3 }),
      delta(KAEL, { state: { stackables: { coin: 2 } } }),
      delta(KAEL, { description: 'A scout.' }),
    ]

    const changes = closeReviewChanges(report(calls), deltas, LOOKUP)

    expect(summaries(changes)).toEqual([['charactersAndFactions', 'Kael', 'A scout. → A ranger.']])
  })

  it('gives no row for a refused or skipped call, whatever values it proposed', () => {
    const calls = [
      call({
        tool: 'update_character',
        rows: [KAEL],
        values: { 'state.voice': 'Flat' },
        result: 'rejected',
        reason: 'row-gone',
      }),
      call({
        tool: 'update_place',
        rows: [QUAY],
        values: { 'state.condition': 'Flooded' },
        result: 'skipped',
        reason: 'user-edited-since-prose',
      }),
      call({ tool: 'update_item', rows: [LAMP], values: { 'state.condition': 'Cracked' } }),
    ]

    expect(summaries(closeReviewChanges(report(calls), [], LOOKUP))).toEqual([
      ['placesAndItems', 'The Lamp', 'Cracked'],
    ])
  })

  it('gives a landed merge with no values its delete rows, pressing to the survivor', () => {
    const calls = [
      call({
        task: 'threads',
        tool: 'merge_threads',
        rows: [LETTER, SEAL],
        survivor: { table: 'threads', id: 'thr_letter' },
      }),
    ]

    const [area] = closeReviewChanges(report(calls), [], LOOKUP)

    expect(area!.rows).toEqual([
      {
        key: '0:threads:thr_seal:delete',
        op: 'delete',
        area: 'threads',
        target: SEAL,
        fieldPath: null,
        fieldLabel: null,
        summary: 'Merged into The letter',
        why: 'Because the chapter says so.',
        entryId: 'entry_112',
        pressTo: { table: 'threads', id: 'thr_letter' },
      },
    ])
  })

  it('names and presses to a survivor the merge left out of its rows', () => {
    const calls = [
      call({ tool: 'merge_threads', rows: [SEAL], survivor: { table: 'threads', id: 'thr_kept' } }),
    ]

    const [area] = closeReviewChanges(report(calls), [], LOOKUP)

    expect(area!.rows.map(({ summary, pressTo }) => [summary, pressTo])).toEqual([
      ['Merged into Unknown row', { table: 'threads', id: 'thr_kept' }],
    ])
  })

  it("gives a landed merge's fields on the survivor beside its delete rows", () => {
    const calls = [
      call({
        task: 'threads',
        tool: 'merge_threads',
        rows: [SEAL, LETTER],
        values: { title: 'The sealed letter' },
        survivor: { table: 'threads', id: 'thr_letter' },
      }),
    ]
    const deltas = [
      delta(LETTER, { title: 'The letter' }),
      delta(SEAL, { id: 'thr_seal' }, 'delete'),
    ]

    const [area] = closeReviewChanges(report(calls), deltas, LOOKUP)

    expect(area!.rows.map((row) => [row.op, row.target.name, row.fieldLabel, row.summary])).toEqual(
      [
        ['delete', 'The seal', null, 'Merged into The letter'],
        ['update', 'The letter', 'Title', 'The letter → The sealed letter'],
      ],
    )
  })

  it('gives a landed create_lore one create row in Lore with its body', () => {
    const calls = [
      call({
        task: 'lore',
        tool: 'create_lore',
        rows: [TITHE],
        values: {
          title: 'The Tithe of Hours',
          body: 'Every adult owes the temple one hour a year.',
        },
        why: 'Sael explains the tithe.',
        turns: ['entry_110', 'entry_112'],
      }),
    ]

    expect(closeReviewChanges(report(calls), [delta(TITHE, null, 'create')], LOOKUP)).toEqual([
      {
        area: 'lore',
        rows: [
          {
            key: '0:lore:lore_tithe:create',
            op: 'create',
            area: 'lore',
            target: TITHE,
            fieldPath: null,
            fieldLabel: null,
            summary: 'Every adult owes the temple one hour a year.',
            why: 'Sael explains the tithe.',
            entryId: 'entry_112',
            pressTo: { table: 'lore', id: 'lore_tithe' },
          },
        ],
      },
    ])
  })

  it('cites the latest turn on the branch, else the last cited, else none', () => {
    const calls = [
      call({
        tool: 'update_character',
        rows: [KAEL],
        values: { description: 'A.' },
        turns: ['entry_118', 'entry_gone'],
      }),
      call({
        tool: 'update_faction',
        rows: [ORDER],
        values: { description: 'B.' },
        turns: ['entry_x', 'entry_y'],
      }),
      call({ tool: 'update_place', rows: [QUAY], values: { description: 'C.' }, turns: [] }),
    ]

    const changes = closeReviewChanges(report(calls), [], LOOKUP)

    expect(changes.flatMap(({ rows }) => rows.map(({ entryId }) => entryId))).toEqual([
      'entry_118',
      'entry_y',
      null,
    ])
  })

  it('names a row its report left nameless by the live store, else by its table', () => {
    const calls = [
      call({
        tool: 'update_character',
        rows: [{ table: 'entities', id: 'char_kael', name: '' }],
        values: { description: 'A.' },
      }),
      call({
        tool: 'update_faction',
        rows: [{ table: 'entities', id: 'fact_none', name: '' }],
        values: { description: 'B.' },
      }),
    ]

    const changes = closeReviewChanges(report(calls), [], LOOKUP)

    expect(changes.flatMap(({ rows }) => rows.map(({ target }) => target.name))).toEqual([
      'Kael today',
      'Unknown row',
    ])
  })
})
