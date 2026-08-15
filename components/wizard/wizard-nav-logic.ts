import type { CalendarSystem } from '@/lib/calendar'
import type { WizardCastDraft, WizardLoreDraft, WizardWorkingState } from '@/lib/db'

import { castStepValid } from './step-cast-logic'
import { needsLead, type Mode, type Narration } from './step-frame-logic'
import { worldStepValid } from './step-world-logic'
import { validateOriginTuple } from './tier-tuple-input-logic'

export const STEP_ORDER = [1, 2, 3, 4, 5] as const

// Single source of truth: DISABLED_STEPS and next/prevActiveStep both derive
// from this, so enabling/disabling a step here is enough to wire it into nav
// everywhere (pills, Next/Back, forward-jump gating) with no other edits.
export const ACTIVE_STEP_ORDER = [1, 2, 3, 4, 5] as const

export const DISABLED_STEPS = new Set<number>(
  STEP_ORDER.filter((s) => !(ACTIVE_STEP_ORDER as readonly number[]).includes(s)),
)

export type StepValidityParams = {
  mode: Mode
  narration: Narration
  cast: readonly WizardCastDraft[]
  leadEntityId: string | null
  worldTimeOrigin: WizardWorkingState['definition']['worldTimeOrigin']
  calendar: CalendarSystem | null
  lore: readonly WizardLoreDraft[]
}

/** Whether `step` is satisfied enough to advance past it (the Next-button gate). */
export function stepForwardValid(step: number, p: StepValidityParams): boolean {
  if (step === 2) return p.calendar != null && validateOriginTuple(p.worldTimeOrigin, p.calendar).ok
  if (step === 3) return worldStepValid(p.lore)
  if (step === 4) return castStepValid(needsLead(p.mode, p.narration), p.cast, p.leadEntityId)
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

/**
 * Next/previous step by position in the active sequence, not by hardcoded
 * pivot values — so a step added to `order` is live in Next/Back without a
 * matching edit here. `order` defaults to `ACTIVE_STEP_ORDER`; tests pass an
 * explicit order to exercise a hypothetical sequence without mutating the
 * real constant.
 */
export function nextActiveStep(step: number, order: readonly number[] = ACTIVE_STEP_ORDER): number {
  const idx = order.indexOf(step)
  if (idx === -1 || idx === order.length - 1) return step
  return order[idx + 1]
}

export function prevActiveStep(step: number, order: readonly number[] = ACTIVE_STEP_ORDER): number {
  const idx = order.indexOf(step)
  if (idx <= 0) return step
  return order[idx - 1]
}
