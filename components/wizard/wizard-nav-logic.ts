import type { CalendarSystem } from '@/lib/calendar'
import type { WizardLoreDraft, WizardWorkingState } from '@/lib/db'

import { needsLead, type Mode, type Narration } from './step-frame-logic'
import { worldStepValid } from './step-world-logic'
import { validateOriginTuple } from './tier-tuple-input-logic'

// Active step sequence — Cast (4) stays disabled until Slice 3.6b.
export const ACTIVE_STEP_ORDER = [1, 2, 3, 5] as const

export type StepValidityParams = {
  mode: Mode
  narration: Narration
  leadName: string
  worldTimeOrigin: WizardWorkingState['definition']['worldTimeOrigin']
  calendar: CalendarSystem | null
  lore: readonly WizardLoreDraft[]
}

/** Whether `step` is satisfied enough to advance past it (the Next-button gate). */
export function stepForwardValid(step: number, p: StepValidityParams): boolean {
  if (step === 1) return !needsLead(p.mode, p.narration) || p.leadName.trim() !== ''
  if (step === 2) return p.calendar != null && validateOriginTuple(p.worldTimeOrigin, p.calendar).ok
  if (step === 3) return worldStepValid(p.lore)
  return true
}

/**
 * Can the pill for `target` be activated from `activeStep`? Backward jumps are
 * always allowed; a forward jump requires the step to have been visited
 * (`target <= furthestStep`) AND every gating step before it to still be valid,
 * so a pill can never land the user past a step they've since invalidated.
 */
export function canJumpToStep(
  target: number,
  activeStep: number,
  furthestStep: number,
  p: StepValidityParams,
): boolean {
  if (target === activeStep) return false
  if (target < activeStep) return true
  if (target > furthestStep) return false
  return ACTIVE_STEP_ORDER.filter((s) => s < target).every((s) => stepForwardValid(s, p))
}
