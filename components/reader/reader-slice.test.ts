import { describe, expect, it } from 'vitest'

import {
  classifyJump,
  deriveSlice,
  editingRowOf,
  extendDown,
  extendUp,
  placeJump,
  markWindowTop,
  reloadSlice,
  resetToTail,
  trimSlice,
  type SliceState,
} from './reader-slice'

type Row = { id: string; position: number; content: string }

const BRANCH = 'b1'
const PAGE = 50

const row = (position: number): Row => ({
  id: `e${position}`,
  position,
  content: `text ${position}`,
})
/** Rows at positions `from`..`to`, ascending. */
const span = (from: number, to: number): Row[] =>
  Array.from({ length: to - from + 1 }, (_, i) => row(from + i))

function slice(top: number, bottom: number | null, extra: Partial<SliceState> = {}): SliceState {
  return { branchId: BRANCH, top, bottom, key: 7, windowHasOlder: true, ...extra }
}

/** The positions a state renders over a window, first and last. */
function shown(state: SliceState, window: Row[]) {
  const view = deriveSlice(state, BRANCH, window, PAGE)
  const rows = view.rows
  return {
    first: rows[0]?.position,
    last: rows.at(-1)?.position,
    count: rows.length,
    hasOlder: view.hasOlder,
    hasNewer: view.hasNewer,
  }
}

const WINDOW = span(1, 120)

describe('deriveSlice — open and branch switch', () => {
  it('opens on the whole window at the tail, older possible after a full page', () => {
    const window = span(71, 120)
    const view = deriveSlice(null, BRANCH, window, PAGE)
    expect(view.rows.map((r) => r.position)).toEqual(window.map((r) => r.position))
    expect(view).toMatchObject({ hasOlder: true, hasNewer: false })
    expect(view.next).toMatchObject({ branchId: BRANCH, top: 71, bottom: null })
  })

  it('opens a short window with its top proven', () => {
    const view = deriveSlice(null, BRANCH, span(1, 12), PAGE)
    expect(view.hasOlder).toBe(false)
    expect(view.next?.windowHasOlder).toBe(false)
  })

  it('opens nothing on an empty window', () => {
    expect(deriveSlice(null, BRANCH, [], PAGE)).toMatchObject({ rows: [], next: null })
  })

  it('reopens on another branch under a later key, whatever its old bounds', () => {
    const old = slice(3, 40, { branchId: 'b0' })
    const view = deriveSlice(old, BRANCH, span(71, 120), PAGE)
    expect(view.next).toMatchObject({ branchId: BRANCH, top: 71, bottom: null })
    expect(view.sliceKey).toBeGreaterThan(old.key)
  })

  it('needs no further change once stored', () => {
    const { next } = deriveSlice(null, BRANCH, WINDOW, PAGE)
    expect(next).not.toBeNull()
    expect(deriveSlice(next, BRANCH, WINDOW, PAGE).next).toBeNull()
  })
})

describe('extendUp', () => {
  it('extends up 25 from the window and trims the bottom back to 50 in the same write', () => {
    const next = extendUp(slice(71, null), WINDOW, { sliceKey: 7, keepId: 'e80' })
    expect(next).toMatchObject({ top: 46, bottom: 95, key: 8 })
    expect(shown(next!, WINDOW)).toMatchObject({ count: 50, hasNewer: true })
  })

  it('never trims past the keep row, holding more than 50 until a later trim', () => {
    const next = extendUp(slice(71, null), WINDOW, { sliceKey: 7, keepId: 'e104' })
    expect(next).toMatchObject({ top: 46, bottom: 104 })
  })

  it('keeps the tail when the keep row is the last', () => {
    expect(extendUp(slice(71, null), WINDOW, { sliceKey: 7, keepId: 'e120' })).toMatchObject({
      top: 46,
      bottom: null,
    })
  })

  it('extends into rows a read just put in the window, and records the top it proved', () => {
    // The slice sat at the window's top (26); the read brought 1..25 and proved the branch top.
    const state = slice(26, 75)
    const next = extendUp(state, WINDOW, { sliceKey: 7, keepId: 'e40' }, false)
    expect(next).toMatchObject({ top: 1, bottom: 50, windowHasOlder: false, key: 8 })
    expect(shown(next!, WINDOW).hasOlder).toBe(false)
  })

  it('ignores a request measured on another slice', () => {
    expect(extendUp(slice(71, null), WINDOW, { sliceKey: 6, keepId: 'e80' })).toBeNull()
  })

  it('trims nothing when the keep row has left the window', () => {
    expect(extendUp(slice(71, null), WINDOW, { sliceKey: 7, keepId: 'gone' })).toMatchObject({
      top: 46,
      bottom: null,
    })
  })

  it('changes nothing at the top of the window', () => {
    expect(extendUp(slice(1, 50), WINDOW, { sliceKey: 7, keepId: 'e20' })).toBeNull()
  })
})

describe('extendDown', () => {
  it('extends down 25 and trims the top back to 50', () => {
    const next = extendDown(slice(1, 50), WINDOW, { sliceKey: 7, keepId: 'e40' })
    expect(next).toMatchObject({ top: 26, bottom: 75, key: 8 })
  })

  it('never trims past the keep row', () => {
    expect(extendDown(slice(1, 50), WINDOW, { sliceKey: 7, keepId: 'e10' })).toMatchObject({
      top: 10,
      bottom: 75,
    })
  })

  it('reaches the tail', () => {
    const next = extendDown(slice(61, 110), WINDOW, { sliceKey: 7, keepId: 'e100' })
    expect(next).toMatchObject({ top: 71, bottom: null })
    expect(shown(next!, WINDOW).hasNewer).toBe(false)
  })

  it('has nothing to do at the tail', () => {
    expect(extendDown(slice(71, null), WINDOW, { sliceKey: 7, keepId: 'e100' })).toBeNull()
  })

  it('ignores a request measured on another slice', () => {
    expect(extendDown(slice(1, 50), WINDOW, { sliceKey: 8, keepId: 'e40' })).toBeNull()
  })
})

describe('trimSlice', () => {
  it('trims a slice grown at the tail by new turns from its top', () => {
    // Four new turns' rows joined a slice that ends at the tail.
    const window = span(1, 124)
    const state = slice(71, null)
    expect(shown(state, window).count).toBe(54)
    expect(trimSlice(state, window, { end: 'top', sliceKey: 7, keepId: 'e110' })).toMatchObject({
      top: 75,
      bottom: null,
    })
  })

  it('stops at the keep row', () => {
    expect(
      trimSlice(slice(46, 104), WINDOW, { end: 'bottom', sliceKey: 7, keepId: 'e98' }),
    ).toMatchObject({ top: 46, bottom: 98 })
  })

  it('leaves the slice short of the tail when the far end is the bottom', () => {
    const next = trimSlice(slice(46, null), WINDOW, { end: 'bottom', sliceKey: 7, keepId: 'e60' })
    expect(next).toMatchObject({ top: 46, bottom: 95 })
    expect(shown(next!, WINDOW).hasNewer).toBe(true)
  })

  it('brings the top skeleton back when it trims below a proven top', () => {
    const state = slice(1, 75, { windowHasOlder: false })
    expect(shown(state, WINDOW).hasOlder).toBe(false)
    const next = trimSlice(state, WINDOW, { end: 'top', sliceKey: 7, keepId: 'e60' })
    expect(next).toMatchObject({ top: 26 })
    expect(shown(next!, WINDOW).hasOlder).toBe(true)
  })

  it('does nothing at or under 50 rows', () => {
    expect(
      trimSlice(slice(71, null), WINDOW, { end: 'top', sliceKey: 7, keepId: 'e100' }),
    ).toBeNull()
  })

  it('ignores a request measured on another slice', () => {
    expect(
      trimSlice(slice(46, 104), WINDOW, { end: 'bottom', sliceKey: 3, keepId: 'e98' }),
    ).toBeNull()
  })
})

describe('jumps', () => {
  it('lands at once when the target and its row above are in the slice', () => {
    const state = slice(71, null)
    expect(classifyJump(state, WINDOW, 'e90')).toBe('slice')
    expect(placeJump(state, WINDOW, 'e90')).toBeNull()
  })

  it('re-slices when only the row above is missing, from that row down', () => {
    const state = slice(71, null)
    expect(classifyJump(state, WINDOW, 'e71')).toBe('window')
    expect(placeJump(state, WINDOW, 'e71')).toMatchObject({ top: 70, bottom: 119, key: 8 })
  })

  it('re-slices to a window row far from the slice', () => {
    const state = slice(71, null)
    expect(classifyJump(state, WINDOW, 'e10')).toBe('window')
    expect(placeJump(state, WINDOW, 'e10')).toMatchObject({ top: 9, bottom: 58 })
  })

  it('falls to the tail’s last 50 when the 50 from the row above would reach the tail', () => {
    const next = placeJump(slice(1, 50), WINDOW, 'e90')
    expect(next).toMatchObject({ top: 71, bottom: null })
  })

  it('reads a target outside the window', () => {
    const window = span(71, 120)
    expect(classifyJump(slice(71, null), window, 'e5')).toBe('read')
    expect(placeJump(slice(71, null), window, 'e5')).toBeNull()
  })

  it('reads the row above the window’s oldest row while older rows may exist', () => {
    const window = span(71, 120)
    expect(classifyJump(slice(71, null), window, 'e71')).toBe('read')
  })

  it('lands at once on the proven branch top in the slice', () => {
    const state = slice(1, 50, { windowHasOlder: false })
    expect(classifyJump(state, WINDOW, 'e1')).toBe('slice')
  })

  it('bumps the key when the top is proven, so the landing waits for the skeleton to drop', () => {
    const state = slice(1, 50)
    const next = markWindowTop(state, false)
    expect(next).toMatchObject({ windowHasOlder: false, key: 8 })
    expect(markWindowTop(next!, false)).toBeNull()
  })
})

describe('jump to bottom', () => {
  it('swaps a slice short of the tail to the tail’s last 50', () => {
    const next = resetToTail(slice(1, 50), WINDOW)
    expect(next).toMatchObject({ top: 71, bottom: null, key: 8 })
  })

  it('changes nothing when the slice is already the tail’s last 50', () => {
    expect(resetToTail(slice(71, null), WINDOW)).toBeNull()
  })
})

describe('the window changing under the slice', () => {
  it('drops rows the window loses and keeps the bounds', () => {
    // A rollback from e30, inside the slice, takes every row from it to the tail.
    const window = span(1, 29)
    const view = deriveSlice(slice(10, 59), BRANCH, window, PAGE)
    expect(view.rows.map((r) => r.position)).toEqual(span(10, 29).map((r) => r.position))
    // Nothing below its bottom any more: it ends at the tail, so new turns extend it.
    expect(view.next).toMatchObject({ top: 10, bottom: null, key: 8 })
    expect(view.hasNewer).toBe(false)
  })

  it('falls back to the tail’s last 50 when it loses every row', () => {
    const window = span(1, 9)
    const view = deriveSlice(slice(10, 59), BRANCH, window, PAGE)
    expect(view.next).toMatchObject({ top: 1, bottom: null })
    expect(view.rows).toHaveLength(9)
  })

  it('takes in rows restored inside its bounds', () => {
    const window = span(1, 120).filter((r) => r.position < 30 || r.position > 40)
    expect(shown(slice(20, 69), window).count).toBe(39)
    expect(shown(slice(20, 69), WINDOW).count).toBe(50)
  })

  it('resets to the tail on a reload, with the reloaded page’s top', () => {
    const window = span(71, 120)
    expect(reloadSlice(slice(10, 59), window, true)).toMatchObject({
      top: 71,
      bottom: null,
      windowHasOlder: true,
      key: 8,
    })
  })

  it('records a reload that proves the top even when the bounds hold', () => {
    const window = span(1, 30)
    expect(reloadSlice(slice(1, null), window, false)).toMatchObject({
      windowHasOlder: false,
      key: 8,
    })
  })

  it('records the top an empty reload proves', () => {
    expect(reloadSlice(slice(1, null), [], false)).toMatchObject({ windowHasOlder: false, key: 8 })
  })

  it('resets to the tail on a document reload', () => {
    expect(resetToTail(slice(10, 59), WINDOW)).toMatchObject({ top: 71, bottom: null })
  })
})

describe('editingRowOf', () => {
  const sliceRows = span(71, 120)

  it('carries the editor’s row while it is in the window but not the slice', () => {
    expect(editingRowOf(WINDOW, sliceRows, 'e12')).toEqual({ id: 'e12', content: 'text 12' })
  })

  it('is absent while the row is in the slice', () => {
    expect(editingRowOf(WINDOW, sliceRows, 'e90')).toBeNull()
  })

  it('is absent once the row has left the window', () => {
    expect(editingRowOf(WINDOW, sliceRows, 'gone')).toBeNull()
  })

  it('is absent with no editor open', () => {
    expect(editingRowOf(WINDOW, sliceRows, null)).toBeNull()
  })
})
