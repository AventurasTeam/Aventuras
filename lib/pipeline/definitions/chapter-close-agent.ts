import type { GroupOutcome } from '@/lib/actions/types'
import type { ResolveModelConfig } from '@/lib/ai'
import { appSettingsStore, currentStoryStore } from '@/lib/stores'

import { readCloseRangeEntries } from './chapter-close-metadata-call'
import { CloseLedgerWriter } from './close-agent/ledger'
import { closeParts, type ClosePart } from './close-agent/parts'
import { closeTaskProgress } from './close-agent/progress'
import { runCloseTask } from './close-agent/run-task'
import {
  closeAgentSlots,
  type CloseAgentSlots,
  type CodeStep,
  type SlotEntry,
  type SlotName,
} from './close-agent/slots'
import type { CloseTaskDef, TaskRunContext } from './close-agent/task'
import { closeIdsOf, requireCloseRange, seedCloseLedger } from './close-intermediates'
import { storesHoldBranch } from './stores-hold-branch'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult } from '../types'

/** What every entry of one run shares; each entry adds its task, part and read fields. */
type AgentContext = Omit<TaskRunContext, 'task' | 'part' | 'readFields'>
type SlotStop = Exclude<PhaseResult, { status: 'completed' }>
/** One entry in run order; a task's `N of M` is placed (and checked) before the run starts. */
type PlannedEntry =
  | { kind: 'code'; step: CodeStep; part: number }
  | { kind: 'task'; def: CloseTaskDef; part: number; progress: { index: number; total: number } }

function plannedEntry(
  entry: SlotEntry,
  slot: SlotName,
  part: number,
  partCount: number,
): PlannedEntry {
  if (entry.kind === 'code') return { kind: 'code', step: entry.step, part }
  const { def } = entry
  return { kind: 'task', def, part, progress: closeTaskProgress(def.task, slot, part, partCount) }
}

/** Canon's run order over the slots; throws on a task its order has no place for. */
function planRun(slots: CloseAgentSlots, parts: readonly ClosePart[]): PlannedEntry[] {
  const partCount = parts.length
  return [
    ...slots.before.map((entry) => plannedEntry(entry, 'before', 0, partCount)),
    ...parts.flatMap(({ index }) =>
      slots.perPart.map((entry) => plannedEntry(entry, 'perPart', index, partCount)),
    ),
    ...slots.after.map((entry) => plannedEntry(entry, 'after', 0, partCount)),
  ]
}

/** One planned entry: null goes on to the next, a stop ends the phase. */
async function* runPlannedEntry(
  planned: PlannedEntry,
  agent: AgentContext,
): AsyncGenerator<PhaseEmittedEvent, SlotStop | null, GroupOutcome | undefined> {
  if (agent.phase.abortSignal.aborted) return { status: 'aborted' }
  const { part } = planned
  if (planned.kind === 'code') {
    const result = yield* planned.step.run({ ...agent, part })
    return result.status === 'completed' ? null : result
  }
  const { def, progress } = planned
  // C6: as the task starts, a task with nothing to show included, so the banner names it.
  yield { type: 'close_task_start', task: def.task, part, ...progress }
  const end = yield* runCloseTask(def, {
    ...agent,
    task: def.task,
    part,
    readFields: def.readFields,
  })
  if (end.status === 'aborted') return { status: 'aborted' }
  if (end.status === 'failed') return { status: 'failed', error: end.error }
  return null
}

/**
 * C2 → agent: the slots in run order (memory/chapter-close.md → Run order), `before` and `after`
 * as part 0 and `perPart` once per part from 1 (C4). A stopped task keeps what landed and the run
 * goes on; a failed or aborted entry ends the phase.
 */
export async function* closeAgentPhase(
  ctx: PhaseContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult, GroupOutcome | undefined> {
  const range = requireCloseRange(ctx)
  if ('status' in range) return range
  const ledgerRecord = seedCloseLedger(ctx.intermediates)
  const slots = closeAgentSlots()
  // No entry, no store or model read: a close with no task is its row, its stamps and the report.
  if (slots.before.length + slots.perPart.length + slots.after.length === 0)
    return { status: 'completed' }

  const open = currentStoryStore.getCurrentStory()
  if (!storesHoldBranch(open, ctx))
    return {
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'chapter-close: branch not loaded' },
    }
  // Read before the first await, while the check above still holds.
  const settings = appSettingsStore.getAppSettings()
  const config: ResolveModelConfig = {
    providers: settings.providers,
    profiles: settings.profiles,
    assignments: settings.assignments,
    storyModels: open.settings.models,
  }
  const ids = closeIdsOf(ctx.intermediates)
  const ledger = new CloseLedgerWriter(ledgerRecord, (id) => ids.nameOfId(id))
  const entries = await readCloseRangeEntries(ctx.db, ctx.branchId, range)
  const chapterEntryIds = entries.map((entry) => entry.id)
  ids.showTurns(chapterEntryIds)
  const plan = planRun(slots, closeParts(entries))
  const agent: AgentContext = {
    db: ctx.db,
    branchId: ctx.branchId,
    endEntryId: range.endEntryId,
    ids,
    survivorOf: (table, id) => ledger.survivorOf(table, id),
    phase: ctx,
    chapterEntryIds,
    ledger,
    config,
  }

  for (const planned of plan) {
    const stop = yield* runPlannedEntry(planned, agent)
    if (stop) return stop
  }
  return { status: 'completed' }
}
