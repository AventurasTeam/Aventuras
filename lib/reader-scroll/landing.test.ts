import { describe, expect, it } from 'vitest'

import { createLandingMachine, type LandingFrame, type LandingStep } from './landing'

const HEIGHT = 5_000

function frame(overrides: Partial<LandingFrame> = {}): LandingFrame {
  return {
    now: 0,
    wheelChainLive: false,
    rowConnected: true,
    laidOut: true,
    fingerDown: false,
    scrollTop: 0,
    ...overrides,
  }
}

function asFrame(step: LandingStep) {
  if (step.kind !== 'frame') throw new Error(`expected a frame, got ${step.kind}`)
  return step
}

/** Runs one frame in which the reader sits still at `scrollTop`. */
function still(
  machine: ReturnType<typeof createLandingMachine>,
  overrides: Partial<LandingFrame> = {},
  scrollHeight = HEIGHT,
) {
  const step = asFrame(machine.plan(frame(overrides)))
  const settle = machine.settle({ after: overrides.scrollTop ?? 0, scrollHeight })
  return { step, settle }
}

describe('createLandingMachine', () => {
  it('lands only once the position has held still for a frame', () => {
    const machine = createLandingMachine()
    expect(still(machine).step.land).toBe(false)
    expect(still(machine).step.land).toBe(true)
  })

  it('writes nothing into a reader that is not laid out', () => {
    const machine = createLandingMachine()
    for (let i = 0; i < 5; i += 1) expect(still(machine, { laidOut: false }).step.land).toBe(false)
    // Laid out again, it still needs a still frame first: the position wasn't read meanwhile.
    expect(still(machine).step.land).toBe(false)
    expect(still(machine).step.land).toBe(true)
  })

  it('writes nothing under a finger', () => {
    const machine = createLandingMachine()
    still(machine)
    for (let i = 0; i < 5; i += 1)
      expect(still(machine, { fingerDown: true }).step.land).toBe(false)
  })

  it('hides overflow while a wheel chain arrives and restores it once the chain ends', () => {
    const machine = createLandingMachine()
    expect(still(machine, { wheelChainLive: true }).step.overflowY).toBe('hidden')
    expect(still(machine, { wheelChainLive: false }).step.overflowY).toBe('')
  })

  it('never settles inside a wheel chain, however still the reader holds', () => {
    const machine = createLandingMachine()
    for (let i = 0; i < 50; i += 1) {
      const { step, settle } = still(machine, { wheelChainLive: true, now: i * 16 })
      if (i > 0) expect(step.land).toBe(true)
      expect(settle.done).toBe(false)
    }
  })

  it('lets go of a wheel chain held for 3 s', () => {
    const machine = createLandingMachine()
    expect(machine.plan(frame({ wheelChainLive: true, now: 1_000 })).kind).toBe('frame')
    machine.settle({ after: 0, scrollHeight: HEIGHT })
    expect(machine.plan(frame({ wheelChainLive: true, now: 3_999 })).kind).toBe('frame')
    machine.settle({ after: 0, scrollHeight: HEIGHT })
    expect(machine.plan(frame({ wheelChainLive: true, now: 4_000 })).kind).toBe('stop')
  })

  it('stops once the row is detached', () => {
    const machine = createLandingMachine()
    still(machine)
    expect(machine.plan(frame({ rowConnected: false })).kind).toBe('stop')
  })

  it('halts a fling once: hides overflow for a frame, then only observes before landing', () => {
    const machine = createLandingMachine()
    // A fling moves the reader every frame; the first frame has nothing to compare against.
    const flung = (scrollTop: number) => {
      const step = asFrame(machine.plan(frame({ scrollTop })))
      return { step, settle: machine.settle({ after: scrollTop, scrollHeight: HEIGHT }) }
    }
    expect(flung(0).settle.haltOverflow).toBe(false)
    expect(flung(40).settle.haltOverflow).toBe(false)
    const halt = flung(80)
    expect(halt.step.land).toBe(false)
    expect(halt.settle.haltOverflow).toBe(true)
    // The fling's in-flight last delta may land a frame later, so that frame restores overflow
    // and writes nothing even when the position reads still.
    const observe = flung(80)
    expect(observe.step).toMatchObject({ land: false, overflowY: '' })
    expect(observe.settle.haltOverflow).toBe(false)
    expect(flung(80).step.land).toBe(true)
    // One halt per landing: a second fling is waited out, not halted.
    flung(200)
    flung(300)
    expect(flung(400).settle.haltOverflow).toBe(false)
  })

  it('settles after ten still landed frames', () => {
    const machine = createLandingMachine()
    still(machine)
    for (let i = 1; i < 10; i += 1) expect(still(machine).settle.done).toBe(false)
    expect(still(machine).settle.done).toBe(true)
  })

  it('restarts the settle count when the content height changes', () => {
    const machine = createLandingMachine()
    still(machine)
    for (let i = 0; i < 5; i += 1) still(machine)
    // Late layout below the row: the count starts over at the new height.
    expect(still(machine, {}, HEIGHT + 30).settle.done).toBe(false)
    for (let i = 1; i < 10; i += 1) expect(still(machine, {}, HEIGHT + 30).settle.done).toBe(false)
    expect(still(machine, {}, HEIGHT + 30).settle.done).toBe(true)
  })

  it('does not count a frame whose write moved the reader as settled', () => {
    const machine = createLandingMachine()
    still(machine)
    // Late layout above the row keeps it moving, so every frame's write moves the reader 12 px,
    // and the next frame reads back where that write put it.
    for (let i = 0; i < 20; i += 1) {
      const step = asFrame(machine.plan(frame({ scrollTop: i * 12 })))
      expect(step.land).toBe(true)
      expect(machine.settle({ after: (i + 1) * 12, scrollHeight: HEIGHT }).done).toBe(false)
    }
  })

  it('gives up after 600 frames that never settle', () => {
    const machine = createLandingMachine()
    for (let i = 1; i < 600; i += 1)
      expect(still(machine, { fingerDown: true }).settle.done).toBe(false)
    expect(still(machine, { fingerDown: true }).settle.done).toBe(true)
  })

  it('highlights the first landed frame only', () => {
    const machine = createLandingMachine()
    expect(still(machine).step.highlight).toBe(false)
    expect(still(machine).step.highlight).toBe(true)
    expect(still(machine).step.highlight).toBe(false)
  })
})
