import { describe, expect, it } from 'vitest'

import { heldControl, turnStartControl } from './entry-card-hold'

const reasons = { gate: 'Updating memory…', held: 'Finish or cancel the edit first.' }

describe('heldControl', () => {
  it('leaves a control neither the gate nor edit focus holds live', () => {
    expect(heldControl(false, false, reasons).disabled).toBe(false)
    expect(heldControl(undefined, undefined, reasons).disabled).toBe(false)
  })

  it("holds a control under edit focus with the edit's reason", () => {
    expect(heldControl(false, true, reasons)).toEqual({ disabled: true, reason: reasons.held })
  })

  it("keeps the gate's reason when the gate holds the control too", () => {
    expect(heldControl(true, true, reasons)).toEqual({ disabled: true, reason: reasons.gate })
  })

  it("keeps the gate's reason under the gate alone", () => {
    expect(heldControl(true, false, reasons)).toEqual({ disabled: true, reason: reasons.gate })
  })
})

describe('turnStartControl', () => {
  const TURN_START = 'This story needs a lead on this branch before it can continue.'
  const all = { ...reasons, turnStart: TURN_START }
  const none = { ...reasons, turnStart: undefined }

  it('leaves a control nothing holds live', () => {
    expect(turnStartControl(false, false, none).disabled).toBe(false)
  })

  it('holds a control with the turn-start reason', () => {
    expect(turnStartControl(false, false, all)).toEqual({ disabled: true, reason: TURN_START })
  })

  it("keeps the gate's reason when the gate holds the control too", () => {
    expect(turnStartControl(true, false, all)).toEqual({ disabled: true, reason: reasons.gate })
    expect(turnStartControl(true, true, all)).toEqual({ disabled: true, reason: reasons.gate })
  })

  // Cancelling the edit elsewhere wouldn't free a control the turn-start reason holds.
  it('outranks edit focus elsewhere', () => {
    expect(turnStartControl(false, true, all)).toEqual({ disabled: true, reason: TURN_START })
  })

  it("falls back to edit focus's hold with no turn-start reason", () => {
    expect(turnStartControl(false, true, none)).toEqual({ disabled: true, reason: reasons.held })
  })
})
