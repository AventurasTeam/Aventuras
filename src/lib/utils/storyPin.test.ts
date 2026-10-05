import { describe, it, expect } from 'vitest'
import { repinDecision, type PinInput, type PinSnapshot } from './storyPin'

const base: PinInput = {
  height: 1000,
  windowStart: 0,
  windowEnd: 10,
  entryCount: 10,
  autoScroll: true,
  userScrolledUp: false,
  hiddenAtBottom: 0,
  editing: false,
  switchingBranch: false,
}

/** Replays a sequence of effect runs, returning each run's decision. */
function replay(inputs: Partial<PinInput>[]): boolean[] {
  let snapshot: PinSnapshot | null = null
  return inputs.map((change) => {
    const result = repinDecision(snapshot, { ...base, ...change })
    snapshot = result.snapshot
    return result.repin
  })
}

describe('repinDecision', () => {
  it('does not re-pin on the first run', () => {
    expect(replay([{}])).toEqual([false])
  })

  it('re-pins when an in-place height change arrives', () => {
    expect(replay([{}, { height: 1080 }])).toEqual([false, true])
  })

  it('does not re-pin when only the guards run again at the same height', () => {
    expect(replay([{}, {}, {}])).toEqual([false, false, false])
  })

  it('does not re-pin a count run followed by its height run', () => {
    expect(
      replay([
        {},
        { entryCount: 11, windowEnd: 11 },
        { entryCount: 11, windowEnd: 11, height: 1200 },
      ]),
    ).toEqual([false, false, false])
  })

  it('does not re-pin a window move followed by its height run', () => {
    expect(replay([{}, { windowStart: 5 }, { windowStart: 5, height: 1200 }])).toEqual([
      false,
      false,
      false,
    ])
  })

  it('re-pins a second height change after a count-change pair', () => {
    const grown = { entryCount: 11, windowEnd: 11 }
    expect(replay([{}, grown, { ...grown, height: 1200 }, { ...grown, height: 1280 }])).toEqual([
      false,
      false,
      false,
      true,
    ])
  })

  it('does not re-pin during a branch switch', () => {
    expect(replay([{}, { height: 1080, switchingBranch: true }])).toEqual([false, false])
  })

  it.each([
    ['auto-scroll is off', { autoScroll: false }],
    ['the reader scrolled up', { userScrolledUp: true }],
    ['later entries are hidden', { hiddenAtBottom: 3 }],
    ['an entry is being edited', { editing: true }],
  ])('does not re-pin when %s', (_, guard) => {
    expect(replay([{}, { height: 1080, ...guard }])).toEqual([false, false])
  })

  it('advances the snapshot on a guarded height change, so the next resize re-pins', () => {
    expect(replay([{}, { height: 1080, editing: true }, { height: 1120 }])).toEqual([
      false,
      false,
      true,
    ])
  })
})
