import { describe, expect, it } from 'vitest'

import { changeAbove, composeHeld, sliceFieldsOf, type SliceFields } from './slice-hold'

type Row = { id: string; content: string }

const row = (n: number, content = `text ${n}`): Row => ({ id: `e${n}`, content })
const rows = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => row(from + i))
const ids = (fields: SliceFields<Row>) => fields.rows.map((r) => r.id)

function slice(from: number, to: number, extra: Partial<SliceFields<Row>> = {}): SliceFields<Row> {
  return {
    rows: rows(from, to),
    worldTimeDecorations: {},
    chapterBreaks: {},
    closeHereEntryIds: {},
    hasOlder: true,
    hasNewer: false,
    sliceKey: 3,
    ...extra,
  }
}

describe('changeAbove', () => {
  it('sees nothing when only rows below the anchor change', () => {
    expect(changeAbove(slice(10, 30), slice(10, 32), 'e20')).toBe('none')
    expect(changeAbove(slice(10, 30), slice(10, 25), 'e20')).toBe('none')
  })

  it('sees rows added above the anchor', () => {
    expect(changeAbove(slice(10, 30), slice(5, 30), 'e20')).toBe('changed')
  })

  it('sees rows removed above the anchor', () => {
    expect(changeAbove(slice(10, 30), slice(15, 30), 'e20')).toBe('changed')
  })

  it('sees a row above replaced by another at the same index', () => {
    const incoming = slice(10, 30)
    incoming.rows[3] = row(99)
    expect(changeAbove(slice(10, 30), incoming, 'e20')).toBe('changed')
  })

  it('sees the top skeleton mount or unmount', () => {
    expect(changeAbove(slice(10, 30), slice(10, 30, { hasOlder: false }), 'e20')).toBe('changed')
  })

  it('sees a chapter break mount above the anchor, the one under the row just above included', () => {
    const shown = slice(10, 30)
    expect(
      changeAbove(shown, slice(10, 30, { chapterBreaks: { e12: { number: 2 } } }), 'e20'),
    ).toBe('changed')
    expect(
      changeAbove(shown, slice(10, 30, { chapterBreaks: { e19: { number: 2 } } }), 'e20'),
    ).toBe('changed')
  })

  it('ignores a break below the anchor and a break that only crossed the bridge again', () => {
    const shown = slice(10, 30, { chapterBreaks: { e12: { number: 2, timeLabel: 'dawn' } } })
    const incoming = slice(10, 30, {
      chapterBreaks: { e12: { number: 2, timeLabel: 'dawn' }, e20: { number: 3 } },
    })
    expect(changeAbove(shown, incoming, 'e20')).toBe('none')
  })

  it('sees a break above that changed its label', () => {
    const shown = slice(10, 30, { chapterBreaks: { e12: { number: 2, timeLabel: 'dawn' } } })
    const incoming = slice(10, 30, { chapterBreaks: { e12: { number: 2, timeLabel: 'dusk' } } })
    expect(changeAbove(shown, incoming, 'e20')).toBe('changed')
  })

  it('reports an anchor the incoming slice lost', () => {
    expect(changeAbove(slice(10, 30), slice(31, 60), 'e20')).toBe('anchorGone')
  })
})

describe('composeHeld', () => {
  it('keeps the rows above the anchor and takes the incoming slice from it down', () => {
    // An upward extension trimmed the bottom in the same write; the prepend waits for rest.
    const held = composeHeld(slice(30, 79), slice(5, 54, { sliceKey: 4, hasNewer: true }), 'e40')
    expect(ids(held)).toEqual(rows(30, 54).map((r) => r.id))
    expect(held).toMatchObject({ hasOlder: true, hasNewer: true, sliceKey: 3 })
  })

  it('takes the latest content of a held row', () => {
    const incoming = slice(10, 30)
    incoming.rows[2] = row(12, 'edited')
    expect(composeHeld(slice(10, 30), incoming, 'e20').rows[2].content).toBe('edited')
  })

  it('keeps a held row the incoming slice trimmed, with its decoration and break', () => {
    const shown = slice(10, 30, {
      worldTimeDecorations: { e11: { label: 'Day 1', raw: 1 } },
      chapterBreaks: { e11: { number: 2 } },
    })
    // A downward extension trimmed the top; the trim waits for rest.
    const held = composeHeld(shown, slice(26, 55), 'e28')
    expect(ids(held).slice(0, 2)).toEqual(['e10', 'e11'])
    expect(held.worldTimeDecorations.e11).toEqual({ label: 'Day 1', raw: 1 })
    expect(held.chapterBreaks.e11).toEqual({ number: 2 })
  })

  it('keeps the close-here marks of held rows the incoming slice dropped, the rest from it', () => {
    const shown = slice(10, 30, { closeHereEntryIds: { e11: true, e13: true, e29: true } })
    // e13 left the open region (a close settled) though the incoming slice still holds it.
    const incoming = slice(12, 40, { closeHereEntryIds: { e15: true, e29: true, e35: true } })
    const held = composeHeld(shown, incoming, 'e20')
    expect(ids(held).slice(0, 2)).toEqual(['e10', 'e11'])
    expect(held.closeHereEntryIds).toEqual({ e11: true, e15: true, e29: true, e35: true })
  })

  it('holds a break mounted above the anchor and shows one mounted below it', () => {
    const held = composeHeld(
      slice(10, 30),
      slice(10, 30, { chapterBreaks: { e12: { number: 2 }, e25: { number: 3 } } }),
      'e20',
    )
    expect(held.chapterBreaks).toEqual({ e25: { number: 3 } })
  })

  it('keeps the shown top skeleton and key', () => {
    const held = composeHeld(slice(10, 30), slice(1, 30, { hasOlder: false, sliceKey: 9 }), 'e20')
    expect(held).toMatchObject({ hasOlder: true, sliceKey: 3 })
  })
})

describe('sliceFieldsOf', () => {
  it('holds the whole shown slice, its close-here marks included', () => {
    const shown = slice(10, 30, { closeHereEntryIds: { e11: true } })
    const props = { ...shown, branchKey: 'br_1' }
    expect(sliceFieldsOf(props)).toEqual(shown)
  })
})
