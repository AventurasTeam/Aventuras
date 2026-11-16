import { describe, expect, it } from 'vitest'

import { heldControl } from './entry-card-hold'

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
