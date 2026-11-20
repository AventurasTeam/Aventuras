import { describe, expect, it } from 'vitest'

import {
  createLandingMachine,
  JUMP_LANDING_GAP_PX,
  type LandingFrame,
  type LandingStep,
} from './landing'

const TARGET_TOP = 1_000
const LANDED_TOP = TARGET_TOP - JUMP_LANDING_GAP_PX

function frame(overrides: Partial<LandingFrame> = {}): LandingFrame {
  return {
    now: 0,
    wheelChainLive: false,
    rowConnected: true,
    laidOut: true,
    fingerDown: false,
    scrollTop: LANDED_TOP,
    targetContentTop: TARGET_TOP,
    ...overrides,
  }
}

function asFrame(step: LandingStep) {
  if (step.kind !== 'frame') throw new Error(`expected a frame, got ${step.kind}`)
  return step
}

/** Runs one frame in which the reader sits still at `scrollTop` (or lands on `targetScrollTop`). */
function still(
  machine: ReturnType<typeof createLandingMachine>,
  overrides: Partial<LandingFrame> = {},
  afterOverride?: number,
) {
  const input = frame(overrides)
  const step = asFrame(machine.plan(input))
  const after = afterOverride ?? (step.land ? step.targetScrollTop : input.scrollTop)
  const settle = machine.settle({ after, targetContentTop: input.targetContentTop })
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

  it('writes nothing under active contact', () => {
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
    machine.settle({ after: LANDED_TOP, targetContentTop: TARGET_TOP })
    expect(machine.plan(frame({ wheelChainLive: true, now: 3_999 })).kind).toBe('frame')
    machine.settle({ after: LANDED_TOP, targetContentTop: TARGET_TOP })
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
      return {
        step,
        settle: machine.settle({ after: scrollTop, targetContentTop: TARGET_TOP }),
      }
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

  it('locks the clamped gap on the first landed frame and ignores growth below', () => {
    const machine = createLandingMachine()
    const clampedScrollTop = 1_500
    const tailTargetTop = 1_800
    // Frame 0 observes from above.
    const f0 = asFrame(machine.plan(frame({ scrollTop: 900, targetContentTop: tailTargetTop })))
    expect(f0.land).toBe(false)
    machine.settle({ after: 900, targetContentTop: tailTargetTop })
    // Frame 1 lands: requests 1800 - 12 = 1788, browser clamps to 1500 -> locks desiredGap = 300.
    const f1 = asFrame(machine.plan(frame({ scrollTop: 900, targetContentTop: tailTargetTop })))
    expect(f1).toMatchObject({ land: true, highlight: true, targetScrollTop: 1_788 })
    expect(machine.settle({ after: clampedScrollTop, targetContentTop: tailTargetTop }).done).toBe(
      false,
    )
    // Subsequent frames target 1500 (never 1788 even if a stream below opens room) and settle in 10.
    for (let i = 1; i < 10; i += 1) {
      const step = asFrame(
        machine.plan(frame({ scrollTop: clampedScrollTop, targetContentTop: tailTargetTop })),
      )
      expect(step.targetScrollTop).toBe(clampedScrollTop)
      expect(
        machine.settle({ after: clampedScrollTop, targetContentTop: tailTargetTop }).done,
      ).toBe(false)
    }
    const finalStep = asFrame(
      machine.plan(frame({ scrollTop: clampedScrollTop, targetContentTop: tailTargetTop })),
    )
    expect(finalStep.targetScrollTop).toBe(clampedScrollTop)
    expect(machine.settle({ after: clampedScrollTop, targetContentTop: tailTargetTop }).done).toBe(
      true,
    )
  })

  it('locks gap to 0 at branch top', () => {
    const machine = createLandingMachine()
    still(machine, { scrollTop: 300, targetContentTop: 0 }, 300)
    const landed = still(machine, { scrollTop: 300, targetContentTop: 0 }, 0)
    expect(landed.step).toMatchObject({ land: true, highlight: true, targetScrollTop: 0 })
    const next = still(machine, { scrollTop: 0, targetContentTop: 0 }, 0)
    expect(next.step.targetScrollTop).toBe(0)
  })

  it('restarts the settle count and tracks pixel-for-pixel when layout shifts above the target', () => {
    const machine = createLandingMachine()
    still(machine)
    for (let i = 0; i < 5; i += 1) still(machine)
    // Growth above moves targetContentTop +40 px: targets LANDED_TOP + 40 and resets settle count.
    const shifted = still(
      machine,
      { scrollTop: LANDED_TOP, targetContentTop: TARGET_TOP + 40 },
      LANDED_TOP + 40,
    )
    expect(shifted.step.targetScrollTop).toBe(LANDED_TOP + 40)
    expect(shifted.settle.done).toBe(false)
    for (let i = 1; i < 10; i += 1)
      expect(
        still(machine, { scrollTop: LANDED_TOP + 40, targetContentTop: TARGET_TOP + 40 }).settle
          .done,
      ).toBe(false)
    expect(
      still(machine, { scrollTop: LANDED_TOP + 40, targetContentTop: TARGET_TOP + 40 }).settle.done,
    ).toBe(true)
  })

  it('does not count a frame whose write moved the reader as settled', () => {
    const machine = createLandingMachine()
    still(machine, { scrollTop: 0, targetContentTop: JUMP_LANDING_GAP_PX }, 0)
    for (let i = 0; i < 20; i += 1) {
      const targetContentTop = (i + 1) * 12 + JUMP_LANDING_GAP_PX
      const step = asFrame(machine.plan(frame({ scrollTop: i * 12, targetContentTop })))
      expect(step.land).toBe(true)
      expect(step.targetScrollTop).toBe((i + 1) * 12)
      expect(machine.settle({ after: (i + 1) * 12, targetContentTop }).done).toBe(false)
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
