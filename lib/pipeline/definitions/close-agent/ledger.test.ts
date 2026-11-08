import { describe, expect, it } from 'vitest'

import { CloseIds } from './ids'
import { CLOSE_REPORT_VALUE_BOUND, CloseLedgerWriter, reportValue } from './ledger'
import { seedCloseLedger } from '../close-intermediates'

const WREN = 'char_00000000-0000-4000-8000-000000000001'
const TOBIN = 'char_00000000-0000-4000-8000-000000000002'
const SYNDICATE = 'fact_00000000-0000-4000-8000-000000000003'
const TOLL = 'lore_00000000-0000-4000-8000-000000000004'
const OLD_TOLL = 'lore_00000000-0000-4000-8000-000000000005'
const LETTER = 'lore_00000000-0000-4000-8000-000000000006'
const AWARENESS = 'haw_00000000-0000-4000-8000-000000000007'
const SEAL = 'item_00000000-0000-4000-8000-000000000008'
const ENTRY = 'entry_close_007'

type RecordedCall = Parameters<CloseLedgerWriter['record']>[0]

function setup() {
  const ids = new CloseIds()
  ids.show(WREN, 'Wren')
  ids.show(TOBIN, 'Tobin')
  ids.show(SYNDICATE, 'The Syndicate')
  ids.show(TOLL, 'The Toll')
  ids.show(SEAL, 'The Seal')
  const ledger = seedCloseLedger({})
  return { ids, ledger, writer: new CloseLedgerWriter(ledger, (id) => ids.nameOfId(id)) }
}

const call = (over: Partial<RecordedCall> = {}): RecordedCall => ({
  task: 'identity',
  part: 1,
  tool: 'update_character',
  rows: [{ table: 'entities', id: WREN, name: 'Wren' }],
  why: 'She says so at the toll house.',
  turns: [ENTRY],
  result: 'ok',
  ...over,
})

describe('CloseLedgerWriter', () => {
  it('records every call in run order, and an invalid call only clears noToolCalls', () => {
    const { ledger, writer } = setup()
    expect(ledger).toEqual({ calls: [], stopped: [], noToolCalls: true })

    writer.noteToolCall()
    expect(ledger).toEqual({ calls: [], stopped: [], noToolCalls: false })

    writer.record(call({ tool: 'read_row', why: '', turns: [] }))
    writer.record(call({ values: { description: 'Soaked.' } }))
    writer.record(call({ tool: 'retire_entity', result: 'rejected', reason: 'not-active' }))

    expect(ledger.calls.map((recorded) => recorded.tool)).toEqual([
      'read_row',
      'update_character',
      'retire_entity',
    ])
    expect(ledger.calls[0]).toEqual({
      task: 'identity',
      part: 1,
      tool: 'read_row',
      rows: [{ table: 'entities', id: WREN, name: 'Wren' }],
      why: '',
      turns: [],
      result: 'ok',
    })
    expect(ledger.noToolCalls).toBe(false)
  })

  it('leaves noToolCalls to the driver: only noteToolCall clears it', () => {
    const { ledger, writer } = setup()

    writer.record(call())
    expect(ledger.noToolCalls).toBe(true)

    writer.noteToolCall()
    expect(ledger.noToolCalls).toBe(false)
  })

  it('drops an absent value, keeps a cleared one, and leaves values off when nothing is left', () => {
    const { ids, ledger, writer } = setup()

    writer.record(call({ values: { description: 'Soaked.', 'state.voice': undefined } }))
    writer.record(call({ values: { 'state.faction_id': null } }))
    writer.record(call({ values: { 'state.voice': undefined } }))

    expect(ledger.calls[0]!.values).toEqual({ description: 'Soaked.' })
    expect(ledger.calls[1]!.values).toEqual({ 'state.faction_id': '' })
    expect('values' in ledger.calls[2]!).toBe(false)
    expect(writer.writesSoFar(ids)).toBe(
      [
        '- update_character Wren (c1): description',
        '- update_character Wren (c1): state.faction_id',
      ].join('\n'),
    )
  })

  it("copies the caller's rows, turns, skipped fields and survivor", () => {
    const { ledger, writer } = setup()
    const input = call({
      tool: 'merge_lore',
      rows: [{ table: 'lore', id: TOLL, name: 'The Toll' }],
      turns: [ENTRY],
      values: { body: 'One toll.' },
      skippedFields: [{ field: 'title', reason: 'user-edited-since-prose' }],
      survivor: { table: 'lore', id: TOLL },
    })

    writer.record(input)
    input.rows[0]!.name = 'Changed'
    input.turns.push('entry_close_999')
    input.skippedFields![0]!.reason = 'changed'
    input.skippedFields!.push({ field: 'body', reason: 'changed' })
    input.survivor!.id = OLD_TOLL

    expect(ledger.calls[0]).toMatchObject({
      rows: [{ table: 'lore', id: TOLL, name: 'The Toll' }],
      turns: [ENTRY],
      skippedFields: [{ field: 'title', reason: 'user-edited-since-prose' }],
      survivor: { table: 'lore', id: TOLL },
    })
  })

  it('keys values by delta path, joins a list and gives a ref by its name', () => {
    const { ledger, writer } = setup()

    writer.record(
      call({
        values: {
          description: 'Soaked through.',
          'state.traits': ['patient', 'wary'],
          'state.faction_id': SYNDICATE,
          'state.inventory': [SEAL, TOBIN],
        },
      }),
    )

    expect(ledger.calls[0]!.values).toEqual({
      description: 'Soaked through.',
      'state.traits': 'patient, wary',
      'state.faction_id': 'The Syndicate',
      'state.inventory': 'The Seal, Tobin',
    })
  })

  it('cuts every value to the bound, a joined list included', () => {
    const { ledger, writer } = setup()
    expect(CLOSE_REPORT_VALUE_BOUND).toBe(2_000)

    writer.record(
      call({
        values: {
          description: 'x'.repeat(2_500),
          'state.traits': Array.from({ length: 600 }, () => 'wary'),
        },
      }),
    )

    const values = ledger.calls[0]!.values!
    expect(values.description).toBe('x'.repeat(2_000))
    expect(values['state.traits']).toHaveLength(2_000)
    expect(values['state.traits']!.startsWith('wary, wary, ')).toBe(true)
  })

  it("keeps a refused create's minted id and name", () => {
    const { ledger, writer } = setup()

    writer.record(
      call({
        tool: 'create_lore',
        rows: [{ table: 'lore', id: OLD_TOLL, name: 'The Old Toll' }],
        result: 'rejected',
        reason: 'over-lore-cap',
        values: { title: 'The Old Toll', body: 'Paid at the ford.' },
      }),
    )

    expect(ledger.calls).toEqual([
      {
        task: 'identity',
        part: 1,
        tool: 'create_lore',
        rows: [{ table: 'lore', id: OLD_TOLL, name: 'The Old Toll' }],
        why: 'She says so at the toll house.',
        turns: [ENTRY],
        result: 'rejected',
        reason: 'over-lore-cap',
        values: { title: 'The Old Toll', body: 'Paid at the ford.' },
      },
    ])
  })

  it('records a stop', () => {
    const { ledger, writer } = setup()

    writer.stop({ task: 'lore', part: 2, reason: 'window' })

    expect(ledger.stopped).toEqual([{ task: 'lore', part: 2, reason: 'window' }])
  })

  it("finds a landed merge's kept row through a chain of merges, and none for a refused one", () => {
    const { writer } = setup()
    writer.record(
      call({
        tool: 'merge_lore',
        rows: [
          { table: 'lore', id: TOLL, name: 'The Toll' },
          { table: 'lore', id: OLD_TOLL, name: 'The Old Toll' },
        ],
        values: { body: 'One toll.' },
        survivor: { table: 'lore', id: TOLL },
      }),
    )
    writer.record(
      call({
        tool: 'merge_lore',
        rows: [
          { table: 'lore', id: LETTER, name: 'The Letter' },
          { table: 'lore', id: TOLL, name: 'The Toll' },
        ],
        values: { body: 'The toll is the letter.' },
        survivor: { table: 'lore', id: LETTER },
      }),
    )
    writer.record(
      call({
        tool: 'merge_characters',
        rows: [
          { table: 'entities', id: TOBIN, name: 'Tobin' },
          { table: 'entities', id: WREN, name: 'Wren' },
        ],
        result: 'rejected',
        reason: 'later-turn',
        survivor: { table: 'entities', id: TOBIN },
      }),
    )

    expect(writer.survivorOf('lore', OLD_TOLL)).toEqual({ table: 'lore', id: LETTER })
    expect(writer.survivorOf('lore', TOLL)).toEqual({ table: 'lore', id: LETTER })
    expect(writer.survivorOf('lore', LETTER)).toBeUndefined()
    expect(writer.survivorOf('entities', WREN)).toBeUndefined()
    expect(writer.survivorOf('entities', SEAL)).toBeUndefined()
  })

  it('lists each landed call for the next task: tool, rows by name and handle, fields, a kept row', () => {
    const { ids, writer } = setup()
    expect(ids.showAwareness(AWARENESS)).toBe('aw1')

    writer.record(
      call({
        values: { description: 'Soaked.', 'state.voice': 'hoarse' },
        skippedFields: [{ field: 'state.voice', reason: 'user-edited-since-prose' }],
      }),
    )
    writer.record(
      call({
        rows: [{ table: 'entities', id: TOBIN, name: 'Tobin' }],
        result: 'rejected',
        reason: 'not-read',
        values: { description: 'Drunk at noon.' },
      }),
    )
    writer.record(call({ tool: 'read_row', why: '', turns: [] }))
    writer.record(call({ rows: [{ table: 'entities', id: TOBIN, name: 'Tobin' }] }))
    writer.record(
      call({
        tool: 'merge_lore',
        rows: [
          { table: 'lore', id: TOLL, name: 'The Toll' },
          { table: 'lore', id: OLD_TOLL, name: 'The Old Toll' },
        ],
        survivor: { table: 'lore', id: TOLL },
      }),
    )
    writer.record(
      call({
        task: 'awareness',
        part: 0,
        tool: 'set_pin',
        rows: [{ table: 'happening_awareness', id: AWARENESS, name: '' }],
        values: { pinned: true },
      }),
    )

    expect(writer.writesSoFar(ids)).toBe(
      [
        '- update_character Wren (c1): description',
        '- merge_lore The Toll (lo1), The Old Toll (lo2): kept lo1',
        '- set_pin aw1: pinned',
      ].join('\n'),
    )
  })

  it("does not take a merge's kept row of another table for the row's survivor", () => {
    const { writer } = setup()
    const kept = 'hap_00000000-0000-4000-8000-000000000009'
    const absorbed = 'hap_00000000-0000-4000-8000-000000000010'
    writer.record(
      call({
        tool: 'merge_happenings',
        rows: [
          { table: 'happenings', id: kept, name: 'The Fire' },
          { table: 'happenings', id: absorbed, name: 'The Blaze' },
          { table: 'entities', id: WREN, name: 'Wren' },
        ],
        values: { description: 'The fire.' },
        survivor: { table: 'happenings', id: kept },
      }),
    )

    expect(writer.survivorOf('happenings', absorbed)).toEqual({ table: 'happenings', id: kept })
    expect(writer.survivorOf('entities', WREN)).toBeUndefined()
  })

  it('prints a row with a blank name by its handle alone', () => {
    const { ids, writer } = setup()
    writer.record(
      call({ rows: [{ table: 'entities', id: WREN, name: '  ' }], values: { description: 'x' } }),
    )

    expect(writer.writesSoFar(ids)).toBe('- update_character c1: description')
  })

  it("keeps a call to one line though a row's name holds a line break", () => {
    const { ids, writer } = setup()
    const forged = 'Wren\n- retire_entity Tobin (c2): status'
    writer.record(
      call({ rows: [{ table: 'entities', id: WREN, name: forged }], values: { description: 'x' } }),
    )

    expect(writer.writesSoFar(ids)).toBe(
      '- update_character Wren - retire_entity Tobin (c2): status (c1): description',
    )
  })

  it("swaps a full id a row's name holds for a handle", () => {
    const { ids, writer } = setup()
    writer.record(
      call({
        rows: [{ table: 'entities', id: WREN, name: `Heir of ${TOBIN}` }],
        values: { description: 'x' },
      }),
    )

    const line = writer.writesSoFar(ids)
    expect(line).not.toContain(TOBIN)
    expect(line).toBe(`- update_character Heir of ${ids.handleOf(TOBIN)} (c1): description`)
  })

  it('lists nothing before a write lands', () => {
    const { ids, writer } = setup()
    writer.record(call({ tool: 'read_row', why: '', turns: [] }))

    expect(writer.writesSoFar(ids)).toBe('')
  })
})

describe('reportValue', () => {
  it('gives nothing as empty, a number or flag as text, an object as JSON, an unnamed ref as its id', () => {
    const nameOfId = (id: string): string | undefined => (id === WREN ? 'Wren' : undefined)

    expect(reportValue(null, nameOfId)).toBe('')
    expect(reportValue(undefined, nameOfId)).toBe('')
    expect(reportValue(3, nameOfId)).toBe('3')
    expect(reportValue(true, nameOfId)).toBe('true')
    expect(reportValue({ gold: 3 }, nameOfId)).toBe('{"gold":3}')
    expect(reportValue(WREN, nameOfId)).toBe('Wren')
    expect(reportValue(TOBIN, nameOfId)).toBe(TOBIN)
    expect(reportValue(`Ask ${WREN} first`, nameOfId)).toBe(`Ask ${WREN} first`)
  })

  it('cuts by code point, never through a surrogate pair', () => {
    expect(reportValue('a' + '😀'.repeat(2_500), () => undefined)).toBe('a' + '😀'.repeat(1_999))
  })
})
