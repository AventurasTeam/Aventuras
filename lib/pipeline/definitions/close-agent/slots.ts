import type { GroupOutcome } from '@/lib/actions/types'

import type { CloseTaskDef, TaskRunContext } from './task'
import type { PhaseEmittedEvent, PhaseResult } from '../../types'

/** A code step's context: a task's, with no task and no read fields. */
export type CodeStepContext = Omit<TaskRunContext, 'task' | 'readFields'>

/** Code inside the agent phase that is no task, such as stackable normalization or the reset. */
export type CodeStep = {
  name: string
  run: (
    ctx: CodeStepContext,
  ) => AsyncGenerator<PhaseEmittedEvent, PhaseResult, GroupOutcome | undefined>
}

export type SlotEntry = { kind: 'task'; def: CloseTaskDef } | { kind: 'code'; step: CodeStep }

/** C2: the agent phase's slots in run order; `perPart` runs once per part. */
export type CloseAgentSlots = {
  before: readonly SlotEntry[]
  perPart: readonly SlotEntry[]
  after: readonly SlotEntry[]
}

/** Empty until the close's tasks land (5.5b, 5.8, 5.9). */
export const PRODUCTION_CLOSE_SLOTS: CloseAgentSlots = Object.freeze({
  before: [],
  perPart: [],
  after: [],
})

let override: CloseAgentSlots | undefined

/** The real close over other slots, for vitest and the probe; undefined restores production. */
export function __setCloseAgentSlots(slots: CloseAgentSlots | undefined): void {
  override = slots
}

export function closeAgentSlots(): CloseAgentSlots {
  return override ?? PRODUCTION_CLOSE_SLOTS
}
