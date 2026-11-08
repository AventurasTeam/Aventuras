import type { GroupOutcome } from '@/lib/actions/types'
import type { CloseTask } from '@/lib/db'

import type { PartTask } from './progress'
import type { CloseTaskDef, TaskRunContext } from './task'
import type { PhaseEmittedEvent, PhaseResult } from '../../types'

/** A code step's context: a task's, with no task, no read fields and no ledger: it records nothing. */
export type CodeStepContext = Omit<TaskRunContext, 'task' | 'readFields' | 'ledger'>

/** Code inside the agent phase that is no task, such as stackable normalization or the reset. */
export type CodeStep = {
  name: string
  run: (
    ctx: CodeStepContext,
  ) => AsyncGenerator<PhaseEmittedEvent, PhaseResult, GroupOutcome | undefined>
}

/** A slot's entry: a code step, or a task of `T`, the tasks canon's run order puts in that slot. */
export type SlotEntry<T extends CloseTask = CloseTask> =
  | { kind: 'task'; def: CloseTaskDef & { task: T } }
  | { kind: 'code'; step: CodeStep }

/** C2: the agent phase's slots in run order; `perPart` runs once per part. */
export type CloseAgentSlots = {
  before: readonly SlotEntry<'happenings'>[]
  perPart: readonly SlotEntry<PartTask>[]
  after: readonly SlotEntry<'awareness'>[]
}

export type SlotName = keyof CloseAgentSlots

/** No close tasks yet (5.5b, 5.8, 5.9). */
export const PRODUCTION_CLOSE_SLOTS: CloseAgentSlots = Object.freeze({
  before: Object.freeze([]),
  perPart: Object.freeze([]),
  after: Object.freeze([]),
})

let override: CloseAgentSlots | undefined

/** The real close over other slots, for vitest and the probe; undefined restores production. */
export function __setCloseAgentSlots(slots: CloseAgentSlots | undefined): void {
  override = slots
}

export function closeAgentSlots(): CloseAgentSlots {
  return override ?? PRODUCTION_CLOSE_SLOTS
}
