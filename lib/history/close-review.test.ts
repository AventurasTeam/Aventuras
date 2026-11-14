import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  CLOSE_REASON_KEYS,
  CLOSE_TASKS,
  closeReportSchema,
  type CloseReport,
  type CloseReportCall,
  type EntityKind,
} from '@/lib/db'
import { i18n } from '@/lib/i18n'
import { hasCopy } from '@/lib/i18n/__tests__/locale-keys'

import { buildCloseReview, closeReviewStopped } from './close-review'
import { closeReviewNotApplied } from './close-review-not-applied'
import type { CloseReviewLookup } from './close-review-types'

const KAEL = { table: 'entities', id: 'char_kael', name: 'Kael' }
const OSS = { table: 'entities', id: 'char_oss', name: 'Oss' }
const ORDER = { table: 'entities', id: 'fact_order', name: 'The Order' }
const QUAY = { table: 'entities', id: 'loc_quay', name: 'The Quay' }
const HARBOUR = { table: 'entities', id: 'loc_harbour', name: 'The Harbour' }
const TOLL = { table: 'lore', id: 'lore_toll', name: 'The Ferry Toll' }
const LETTER = { table: 'threads', id: 'thr_letter', name: 'The letter' }
const SEAL = { table: 'threads', id: 'thr_seal', name: 'The seal' }
const FIRE = { table: 'happenings', id: 'hap_fire', name: 'The fire' }
const STORM = { table: 'happenings', id: 'hap_storm', name: 'The storm' }

const KINDS = new Map<string, EntityKind>([
  ['char_kael', 'character'],
  ['char_oss', 'character'],
  ['fact_order', 'faction'],
  ['loc_quay', 'location'],
  ['loc_harbour', 'location'],
])

const LOOKUP: CloseReviewLookup = {
  entityKind: (id) => KINDS.get(id),
  nameOf: () => undefined,
  entryPosition: () => undefined,
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

function report(calls: CloseReportCall[], fields: Partial<CloseReport> = {}): CloseReport {
  return { version: 1, actionId: 'act_close', calls, stopped: [], noToolCalls: false, ...fields }
}

const notApplied = (calls: CloseReportCall[]) =>
  closeReviewNotApplied(report(calls), LOOKUP).map((row) => [
    row.target?.name ?? null,
    row.fieldPath,
    row.summary,
    row.reasonKey,
  ])

describe('closeReviewNotApplied', () => {
  it('holds a refused write, one row per proposed field, with its value and reason', () => {
    const rows = closeReviewNotApplied(
      report([
        call({
          tool: 'update_character',
          rows: [KAEL],
          values: { 'state.voice': 'Flat', description: 'A ranger.' },
          result: 'skipped',
          reason: 'user-edited-since-prose',
        }),
      ]),
      LOOKUP,
    )

    expect(rows).toEqual([
      {
        key: '0:entities:char_kael:state.voice',
        op: 'update',
        tool: 'update_character',
        target: KAEL,
        fieldPath: 'state.voice',
        fieldLabel: 'Voice',
        summary: 'Flat',
        reasonKey: 'user-edited-since-prose',
        reasonText: 'You changed this after the cited entry.',
        pressTo: { table: 'entities', id: 'char_kael' },
      },
      {
        key: '0:entities:char_kael:description',
        op: 'update',
        tool: 'update_character',
        target: KAEL,
        fieldPath: 'description',
        fieldLabel: 'Description',
        summary: 'A ranger.',
        reasonKey: 'user-edited-since-prose',
        reasonText: 'You changed this after the cited entry.',
        pressTo: { table: 'entities', id: 'char_kael' },
      },
    ])
  })

  it('drops a refused field the same task later landed with the same tool on that row', () => {
    expect(
      notApplied([
        call({
          tool: 'update_character',
          rows: [KAEL],
          values: { 'state.voice': 'Flat', description: 'A.' },
          result: 'rejected',
          reason: 'turn-in-text',
        }),
        call({ tool: 'update_character', rows: [KAEL], values: { 'state.voice': 'Flat' } }),
      ]),
    ).toEqual([['Kael', 'description', 'A.', 'turn-in-text']])
  })

  it('keeps a refused field a different task, another tool or another row landed', () => {
    expect(
      notApplied([
        call({
          tool: 'update_character',
          rows: [KAEL],
          values: { 'state.voice': 'Flat' },
          result: 'rejected',
          reason: 'turn-in-text',
        }),
        call({
          task: 'lifecycle',
          tool: 'update_character',
          rows: [KAEL],
          values: { 'state.voice': 'Flat' },
        }),
        call({ tool: 'set_keywords', rows: [KAEL], values: { 'state.voice': 'Flat' } }),
        call({ tool: 'update_character', rows: [OSS], values: { 'state.voice': 'Flat' } }),
      ]),
    ).toEqual([['Kael', 'state.voice', 'Flat', 'turn-in-text']])
  })

  it('keeps a refusal an earlier landing preceded, judging only later calls', () => {
    expect(
      notApplied([
        call({ tool: 'update_character', rows: [KAEL], values: { 'state.voice': 'Flat' } }),
        call({
          tool: 'update_character',
          rows: [KAEL],
          values: { 'state.voice': 'Hoarse' },
          result: 'skipped',
          reason: 'later-turn',
        }),
      ]),
    ).toEqual([['Kael', 'state.voice', 'Hoarse', 'later-turn']])
  })

  it('keeps a refused field whose retry was refused too, listing both', () => {
    expect(
      notApplied([
        call({
          tool: 'update_character',
          rows: [KAEL],
          values: { 'state.voice': 'Flat' },
          result: 'rejected',
          reason: 'turn-in-text',
        }),
        call({
          tool: 'update_character',
          rows: [KAEL],
          values: { 'state.voice': 'Flat' },
          result: 'skipped',
          reason: 'later-turn',
        }),
      ]),
    ).toEqual([
      ['Kael', 'state.voice', 'Flat', 'turn-in-text'],
      ['Kael', 'state.voice', 'Flat', 'later-turn'],
    ])
  })

  it('keeps a refused field a later landed call lost again, listing both', () => {
    expect(
      notApplied([
        call({
          tool: 'update_character',
          rows: [KAEL],
          values: { 'state.voice': 'Flat' },
          result: 'rejected',
          reason: 'turn-in-text',
        }),
        call({
          tool: 'update_character',
          rows: [KAEL],
          values: { description: 'A ranger.', 'state.voice': 'Hoarse' },
          skippedFields: [{ field: 'state.voice', reason: 'user-edited-since-prose' }],
        }),
      ]),
    ).toEqual([
      ['Kael', 'state.voice', 'Flat', 'turn-in-text'],
      ['Kael', 'state.voice', 'Hoarse', 'user-edited-since-prose'],
    ])
  })

  it("lists a partly landed call's lost field here and its landed one under Changes", () => {
    const review = buildCloseReview(
      report([
        call({
          tool: 'update_character',
          rows: [KAEL],
          values: { 'state.voice': 'Flat', 'state.traits': 'a, b, c, d, e, f, g, h, i' },
          skippedFields: [{ field: 'state.traits', reason: 'over-soft-cap' }],
        }),
      ]),
      [],
      LOOKUP,
    )

    expect(
      review.changes.flatMap(({ rows }) => rows.map((row) => [row.fieldPath, row.summary])),
    ).toEqual([['state.voice', 'Flat']])
    expect(review.notApplied.map((row) => [row.fieldPath, row.summary, row.reasonText])).toEqual([
      ['state.traits', 'a, b, c, d, e, f, g, h, i', 'The list is over its cap.'],
    ])
    expect(review.noToolCalls).toBe(false)
  })

  it("gives each field of a skipped call its own reason when they differ, else the call's", () => {
    expect(
      notApplied([
        call({
          tool: 'update_character',
          rows: [KAEL],
          values: { 'state.voice': 'Flat', description: 'A.', 'state.drives': 'Home' },
          result: 'skipped',
          reason: 'later-turn',
          skippedFields: [
            { field: 'state.voice', reason: 'later-turn' },
            { field: 'description', reason: 'user-edited-since-prose' },
          ],
        }),
      ]),
    ).toEqual([
      ['Kael', 'state.voice', 'Flat', 'later-turn'],
      ['Kael', 'description', 'A.', 'user-edited-since-prose'],
      ['Kael', 'state.drives', 'Home', 'later-turn'],
    ])
  })

  it('counts a place parent and its unplaced mark as one field', () => {
    expect(
      notApplied([
        call({
          task: 'upkeep',
          tool: 'update_place',
          rows: [QUAY],
          values: { 'state.parent_location_id': 'The Harbour' },
          result: 'rejected',
          reason: 'parent-cycle',
        }),
        call({
          task: 'upkeep',
          tool: 'update_place',
          rows: [QUAY],
          values: { 'state.unplaced': 'top level' },
        }),
      ]),
    ).toEqual([])
  })

  it('drops an update_lore refused as unread once read_row and the same call land it', () => {
    expect(
      notApplied([
        call({
          task: 'lore',
          tool: 'update_lore',
          rows: [TOLL],
          result: 'rejected',
          reason: 'unread',
        }),
        call({ task: 'lore', tool: 'read_row', rows: [TOLL], why: '', turns: [] }),
        call({ task: 'lore', tool: 'update_lore', rows: [TOLL], values: { category: 'tolls' } }),
      ]),
    ).toEqual([])
  })

  it('drops a create_lore refused for an empty why once the same task lands one', () => {
    expect(
      notApplied([
        call({
          task: 'lore',
          tool: 'create_lore',
          rows: [],
          result: 'rejected',
          reason: 'why-empty',
        }),
        call({
          task: 'lore',
          tool: 'create_lore',
          rows: [{ table: 'lore', id: 'lore_new', name: 'The Toll' }],
          values: { title: 'The Toll', body: 'Paid.' },
        }),
      ]),
    ).toEqual([])
  })

  it('drops a refusal naming two rows once the same tool lands on one of them', () => {
    expect(
      notApplied([
        call({
          task: 'upkeep',
          tool: 'update_place',
          rows: [QUAY, HARBOUR],
          result: 'rejected',
          reason: 'unread',
        }),
        call({
          task: 'upkeep',
          tool: 'update_place',
          rows: [QUAY],
          values: { 'state.condition': 'Flooded' },
        }),
      ]),
    ).toEqual([])
  })

  it('keeps a value-less refusal the task never retried, by its tool and rows', () => {
    const rows = closeReviewNotApplied(
      report([
        call({
          task: 'upkeep',
          tool: 'update_place',
          rows: [QUAY],
          result: 'rejected',
          reason: 'unread',
        }),
        call({ task: 'upkeep', tool: 'set_keywords', rows: [QUAY], values: { keywords: 'quay' } }),
      ]),
      LOOKUP,
    )

    expect(rows).toEqual([
      {
        key: '0:entities:loc_quay:update_place',
        op: 'update',
        tool: 'update_place',
        target: QUAY,
        fieldPath: null,
        fieldLabel: null,
        summary: '',
        reasonKey: 'unread',
        reasonText: 'The write came before the row was read.',
        pressTo: { table: 'entities', id: 'loc_quay' },
      },
    ])
  })

  it('drops a refused create_lore by a later landed one of the same task and title, trimmed and case-folded', () => {
    const refused = call({
      task: 'lore',
      tool: 'create_lore',
      rows: [{ table: 'lore', id: 'lore_minted', name: 'The Tithe' }],
      values: { title: 'The Tithe', body: 'An hour a year.' },
      result: 'rejected',
      reason: 'lore-cap',
    })
    const landed = (task: CloseReportCall['task'], title: string) =>
      call({
        task,
        tool: 'create_lore',
        rows: [{ table: 'lore', id: 'lore_landed', name: title }],
        values: { title, body: 'An hour a year.' },
      })

    expect(notApplied([refused, landed('lore', 'the tithe ')])).toEqual([])
    expect(notApplied([refused, landed('upkeep', 'the tithe ')])).toEqual([
      ['The Tithe', null, 'An hour a year.', 'lore-cap'],
    ])
    expect(notApplied([refused, landed('lore', 'The Tithes')])).toEqual([
      ['The Tithe', null, 'An hour a year.', 'lore-cap'],
    ])
  })

  it('gives a refused create_lore its proposed body, the create badge and no press', () => {
    const [row] = closeReviewNotApplied(
      report([
        call({
          task: 'lore',
          tool: 'create_lore',
          rows: [{ table: 'lore', id: 'lore_minted', name: 'The Tithe' }],
          values: { title: 'The Tithe', body: 'Every adult owes the temple one hour a year.' },
          result: 'rejected',
          reason: 'title-taken',
        }),
      ]),
      LOOKUP,
    )

    expect(row).toMatchObject({
      op: 'create',
      target: { table: 'lore', id: 'lore_minted', name: 'The Tithe' },
      summary: 'Every adult owes the temple one hour a year.',
      pressTo: null,
    })
  })

  it('gives a refused merge holding values one row with its text, and no delete row under Changes', () => {
    const review = buildCloseReview(
      report([
        call({
          task: 'threads',
          tool: 'merge_threads',
          rows: [LETTER, SEAL],
          values: { title: 'The sealed letter', description: 'Wren carries the sealed letter.' },
          result: 'rejected',
          reason: 'merge-active-into-inactive',
        }),
      ]),
      [],
      LOOKUP,
    )

    expect(review.changes).toEqual([])
    expect(review.notApplied).toEqual([
      {
        key: '0:threads:thr_letter:merge_threads',
        op: 'update',
        tool: 'merge_threads',
        target: LETTER,
        fieldPath: null,
        fieldLabel: null,
        summary: 'Wren carries the sealed letter.',
        reasonKey: 'merge-active-into-inactive',
        reasonText: 'An active thread can fold only into another active one.',
        pressTo: { table: 'threads', id: 'thr_letter' },
      },
    ])
  })

  it('drops a refused merge once the same task lands a merge over a row they share', () => {
    expect(
      notApplied([
        call({
          task: 'threads',
          tool: 'merge_threads',
          rows: [LETTER, SEAL],
          values: { title: 'X' },
          result: 'skipped',
          reason: 'later-turn',
        }),
        call({
          task: 'threads',
          tool: 'merge_threads',
          rows: [SEAL, LETTER],
          survivor: { table: 'threads', id: 'thr_seal' },
        }),
      ]),
    ).toEqual([])
  })

  it('drops a flag_duplicate refused on a pair once the same task lands it the other way round', () => {
    expect(
      notApplied([
        call({
          task: 'lifecycle',
          tool: 'flag_duplicate',
          rows: [KAEL, OSS],
          values: { nameCollisionPartnerId: 'Oss' },
          result: 'skipped',
          reason: 'later-turn',
        }),
        call({
          task: 'lifecycle',
          tool: 'flag_duplicate',
          rows: [OSS, KAEL],
          values: { nameCollisionPartnerId: 'Kael' },
        }),
      ]),
    ).toEqual([])
  })

  it('reads a stored reason that is no key as other, and a refusal stored with none', () => {
    const refused = (fields: Record<string, unknown>) => ({
      ...call({ tool: 'update_faction', rows: [ORDER], result: 'rejected' }),
      ...fields,
    })
    const stored = closeReportSchema.parse({
      ...report([]),
      calls: [
        refused({ values: { description: 'A.' }, reason: 'not a key' }),
        refused({
          values: { 'state.standing': 'B.', 'state.agenda': 'C.' },
          reason: 'later-turn',
          skippedFields: [{ field: 'state.agenda', reason: 'not a key either' }],
        }),
        refused({ values: { title: 'D.' } }),
      ],
    })

    const rows = closeReviewNotApplied(stored, LOOKUP)

    expect(
      rows.map(({ fieldPath, reasonKey, reasonText }) => [fieldPath, reasonKey, reasonText]),
    ).toEqual([
      ['description', 'other', 'Not applied for another reason.'],
      ['state.standing', 'later-turn', 'A later entry already changed this.'],
      ['state.agenda', 'other', 'Not applied for another reason.'],
      ['title', 'other', 'Not applied for another reason.'],
    ])
  })

  it('shows a proposed flag as yes or no, an empty value as none, and the top mark in words', () => {
    expect(
      notApplied([
        call({
          task: 'upkeep',
          tool: 'mark_common_knowledge',
          rows: [FIRE],
          values: { commonKnowledge: '1' },
          result: 'skipped',
          reason: 'later-turn',
        }),
        call({
          task: 'upkeep',
          tool: 'set_keywords',
          rows: [QUAY],
          values: { keywords: '' },
          result: 'skipped',
          reason: 'keyword-user-added',
        }),
        call({
          task: 'upkeep',
          tool: 'update_place',
          rows: [HARBOUR],
          values: { 'state.unplaced': 'top level' },
          result: 'rejected',
          reason: 'not-unplaced',
        }),
      ]),
    ).toEqual([
      ['The fire', 'commonKnowledge', 'Yes', 'later-turn'],
      ['The Quay', 'keywords', 'none', 'keyword-user-added'],
      ['The Harbour', 'state.unplaced', 'Top level', 'not-unplaced'],
    ])
  })

  it("shows a refused flag's value as Changes shows a landed one", () => {
    const review = buildCloseReview(
      report([
        call({
          task: 'upkeep',
          tool: 'mark_common_knowledge',
          rows: [FIRE],
          values: { commonKnowledge: '1' },
        }),
        call({
          task: 'upkeep',
          tool: 'mark_common_knowledge',
          rows: [STORM],
          values: { commonKnowledge: '1' },
          result: 'skipped',
          reason: 'later-turn',
        }),
      ]),
      [],
      LOOKUP,
    )

    expect(review.changes.flatMap(({ rows }) => rows.map((row) => row.summary))).toEqual(['Yes'])
    expect(review.notApplied.map((row) => row.summary)).toEqual(['Yes'])
  })

  it('keeps a value-less refusal when the same tool landed only on another row', () => {
    expect(
      notApplied([
        call({
          task: 'upkeep',
          tool: 'update_place',
          rows: [QUAY],
          result: 'rejected',
          reason: 'unread',
        }),
        call({
          task: 'upkeep',
          tool: 'update_place',
          rows: [HARBOUR],
          values: { 'state.condition': 'Flooded' },
        }),
      ]),
    ).toEqual([['The Quay', null, '', 'unread']])
  })

  it('keeps a refused merge when the same task merged two other threads', () => {
    const FERRY = { table: 'threads', id: 'thr_ferry', name: 'The ferry' }
    const TOLLS = { table: 'threads', id: 'thr_tolls', name: 'The tolls' }

    expect(
      notApplied([
        call({
          task: 'threads',
          tool: 'merge_threads',
          rows: [LETTER, SEAL],
          values: { title: 'The sealed letter' },
          result: 'rejected',
          reason: 'merge-close-wrote',
        }),
        call({
          task: 'threads',
          tool: 'merge_threads',
          rows: [FERRY, TOLLS],
          survivor: { table: 'threads', id: 'thr_ferry' },
        }),
      ]),
    ).toEqual([['The letter', null, 'The sealed letter', 'merge-close-wrote']])
  })

  it('gives a refused happening merge one row with its text', () => {
    const HUNT = { table: 'happenings', id: 'hap_hunt', name: 'The hunt' }

    expect(
      notApplied([
        call({
          task: 'happenings',
          tool: 'merge_happenings',
          rows: [FIRE, HUNT],
          values: { title: 'The fire', description: 'The quay burned.' },
          result: 'skipped',
          reason: 'later-turn',
        }),
      ]),
    ).toEqual([['The fire', null, 'The quay burned.', 'later-turn']])
  })

  it("labels a landed happening merge's link-row losses by their link table, never the raw path", () => {
    const BLAZE = { table: 'happenings', id: 'hap_blaze', name: 'The blaze' }
    const lost = [
      'decayResistance',
      'learnedAtEntryId',
      'retrievalCount',
      'source',
      'role',
      'entityId',
      'characterId',
    ]

    const rows = closeReviewNotApplied(
      report([
        call({
          task: 'happenings',
          part: 0,
          tool: 'merge_happenings',
          rows: [FIRE, BLAZE],
          survivor: { table: 'happenings', id: 'hap_fire' },
          skippedFields: lost.map((field) => ({ field, reason: 'user-edited-since-prose' })),
        }),
      ]),
      LOOKUP,
    )

    expect(rows.map((row) => [row.target?.name, row.fieldPath, row.fieldLabel])).toEqual([
      ['The fire', 'decayResistance', 'Decay resistance'],
      ['The fire', 'learnedAtEntryId', 'Learned at'],
      ['The fire', 'retrievalCount', 'Retrieval count'],
      ['The fire', 'source', 'Source'],
      ['The fire', 'role', 'Role'],
      ['The fire', 'entityId', 'Involvement'],
      ['The fire', 'characterId', 'Awareness'],
    ])
  })

  it('shows a proposed entry id the branch knows as its ref', () => {
    const rows = closeReviewNotApplied(
      report([
        call({
          task: 'threads',
          tool: 'update_thread',
          rows: [LETTER],
          values: { resolvedAtEntryId: 'entry_118', description: 'entry_gone' },
          result: 'skipped',
          reason: 'later-turn',
        }),
      ]),
      { ...LOOKUP, entryPosition: (id) => (id === 'entry_118' ? 118 : undefined) },
    )

    expect(rows.map((row) => [row.fieldPath, row.summary])).toEqual([
      ['resolvedAtEntryId', 'entry #118'],
      ['description', 'entry_gone'],
    ])
  })

  it("shows a refused retirement's status in the locale's words", async () => {
    i18n.addResourceBundle('xx', 'world', { status: { retired: 'retirado' } })
    await i18n.changeLanguage('xx')
    try {
      expect(
        notApplied([
          call({
            task: 'lifecycle',
            tool: 'retire_entity',
            rows: [KAEL],
            values: { status: 'retired' },
            result: 'skipped',
            reason: 'later-turn',
          }),
        ]),
      ).toEqual([['Kael', 'status', 'retirado', 'later-turn']])
    } finally {
      await i18n.changeLanguage('en')
    }
  })

  it.each([
    ['no values', {}],
    ['an empty values', { values: {} }],
  ])('keeps a refusal with %s as one row by its tool', (_label, values) => {
    expect(
      notApplied([
        call({
          task: 'threads',
          tool: 'update_thread',
          rows: [LETTER],
          ...values,
          result: 'rejected',
          reason: 'nothing-sent',
        }),
      ]),
    ).toEqual([['The letter', null, '', 'nothing-sent']])
  })

  it('keeps a refused merge and a refused create with an empty values', () => {
    expect(
      notApplied([
        call({
          task: 'threads',
          tool: 'merge_threads',
          rows: [LETTER, SEAL],
          values: {},
          result: 'rejected',
          reason: 'merge-repeated',
        }),
        call({
          task: 'lore',
          tool: 'create_lore',
          rows: [TOLL],
          values: {},
          result: 'rejected',
          reason: 'lore-cap',
        }),
      ]),
    ).toEqual([
      ['The letter', null, '', 'merge-repeated'],
      ['The Ferry Toll', null, 'The Ferry Toll', 'lore-cap'],
    ])
  })

  it("matches a refused create_lore's title by its row name when it sent no title", () => {
    expect(
      notApplied([
        call({
          task: 'lore',
          tool: 'create_lore',
          rows: [{ table: 'lore', id: 'lore_minted', name: 'The Tithe' }],
          values: { body: 'An hour a year.' },
          result: 'rejected',
          reason: 'lore-cap',
        }),
        call({
          task: 'lore',
          tool: 'create_lore',
          rows: [{ table: 'lore', id: 'lore_landed', name: 'The Tithe' }],
          values: { title: 'The Tithe', body: 'An hour a year.' },
        }),
      ]),
    ).toEqual([])
  })

  it('presses a lost field of a landed create_lore to the row it made', () => {
    const [row] = closeReviewNotApplied(
      report([
        call({
          task: 'lore',
          tool: 'create_lore',
          rows: [{ table: 'lore', id: 'lore_tithe', name: 'The Tithe' }],
          values: { title: 'The Tithe', body: 'An hour a year.', category: 'temple law' },
          skippedFields: [{ field: 'category', reason: 'turn-in-text' }],
        }),
      ]),
      LOOKUP,
    )

    expect(row).toMatchObject({
      op: 'create',
      fieldPath: 'category',
      summary: 'temple law',
      pressTo: { table: 'lore', id: 'lore_tithe' },
    })
  })

  it("shows a landed call's lost empty value as none, and a lost field with no value as empty", () => {
    expect(
      notApplied([
        call({
          tool: 'update_character',
          rows: [KAEL],
          values: { 'state.voice': 'Flat', 'state.drives': '' },
          skippedFields: [
            { field: 'state.drives', reason: 'user-edited-since-prose' },
            { field: 'state.traits', reason: 'user-edited-since-prose' },
          ],
        }),
      ]),
    ).toEqual([
      ['Kael', 'state.drives', 'none', 'user-edited-since-prose'],
      ['Kael', 'state.traits', '', 'user-edited-since-prose'],
    ])
  })

  it('labels every reason key', () => {
    for (const key of CLOSE_REASON_KEYS) expect(hasCopy(`chapters:review.reason.${key}`)).toBe(true)
  })
})

describe('closeReviewStopped and the no-tool note', () => {
  it('names the task, its part unless chapter-wide, and why it stopped', () => {
    const stopped = closeReviewStopped(
      report([], {
        stopped: [
          { task: 'identity', part: 2, reason: 'budget' },
          { task: 'happenings', part: 0, reason: 'window' },
          { task: 'lore', part: 1, reason: 'cut-off' },
        ],
      }),
    )

    expect(stopped.map(({ text }) => text)).toEqual([
      'Identity, part 2 — reached its step limit',
      'Happenings — outgrew the context window',
      'Lore, part 1 — a reply was cut off or filtered twice',
    ])
    expect(stopped[0]).toMatchObject({ task: 'identity', part: 2, reason: 'budget' })
  })

  it('carries the note when no task called a tool, with no stopped task', () => {
    const review = buildCloseReview(report([], { noToolCalls: true }), [], LOOKUP)

    expect(review).toEqual({ stopped: [], noToolCalls: true, notApplied: [], changes: [] })
    expect(hasCopy('chapters:review.noToolCalls')).toBe(true)
  })
})

// Every label unique, so a key that borrows another's copy shows, even where English repeats one.
describe('the review copy, in a locale that names every key apart', () => {
  const LANG = 'xk'

  beforeAll(() => {
    i18n.addResourceBundle(
      LANG,
      'chapters',
      {
        review: {
          reason: Object.fromEntries(CLOSE_REASON_KEYS.map((key) => [key, `reason:${key}`])),
          stopped: { lineNoPart: '{{task}} | {{reason}}', budget: 'stop:budget' },
        },
      },
      true,
      true,
    )
    i18n.addResourceBundle(
      LANG,
      'common',
      {
        chrome: {
          memoryBanner: {
            closeTask: Object.fromEntries(CLOSE_TASKS.map((task) => [task, `task:${task}`])),
          },
        },
      },
      true,
      true,
    )
  })

  beforeEach(async () => {
    await i18n.changeLanguage(LANG)
  })

  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('labels each refusal by its own reason', () => {
    const rows = closeReviewNotApplied(
      report(
        CLOSE_REASON_KEYS.map((reason) =>
          call({ tool: 'update_character', rows: [KAEL], result: 'rejected', reason }),
        ),
      ),
      LOOKUP,
    )

    expect(rows.map(({ reasonKey, reasonText }) => [reasonKey, reasonText])).toEqual(
      CLOSE_REASON_KEYS.map((key) => [key, `reason:${key}`]),
    )
  })

  it('names each stopped task by its own label', () => {
    const stopped = closeReviewStopped(
      report([], { stopped: CLOSE_TASKS.map((task) => ({ task, part: 0, reason: 'budget' })) }),
    )

    expect(stopped.map(({ text }) => text)).toEqual(
      CLOSE_TASKS.map((task) => `task:${task} | stop:budget`),
    )
  })
})
