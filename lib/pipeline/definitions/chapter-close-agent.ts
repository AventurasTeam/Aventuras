import type { GroupOutcome } from '@/lib/actions/types'
import type { ResolveModelConfig } from '@/lib/ai'
import { appSettingsStore, currentStoryStore } from '@/lib/stores'

import { readCloseRangeEntries } from './chapter-close-metadata-call'
import { CloseLedgerWriter } from './close-agent/ledger'
import { closeParts, type ClosePart } from './close-agent/parts'
import { closeTaskProgress } from './close-agent/progress'
import { runCloseTask, type TaskRunArgs } from './close-agent/run-task'
import {
  closeAgentSlots,
  type CloseAgentSlots,
  type CodeStep,
  type SlotEntry,
  type SlotName,
} from './close-agent/slots'
import type { CloseTaskDef } from './close-agent/task'
import {
  closeIdsOf,
  requireCloseParts,
  requireCloseRange,
  seedCloseLedger,
} from './close-intermediates'
import { storesHoldBranch } from './stores-hold-branch'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult } from '../types'

/** What every entry of one run shares; each adds its part and the entries it is shown. */
type AgentContext = Omit<TaskRunArgs, 'part' | 'taskEntryIds'>
type SlotStop = Exclude<PhaseResult, { status: 'completed' }>
/** One entry in run order; a task's `N of M` is placed (and checked) before the run starts. */
type PlannedEntry =
  | { kind: 'code'; step: CodeStep; part: number; entryIds: readonly string[] }
  | {
      kind: 'task'
      def: CloseTaskDef
      part: number
      entryIds: readonly string[]
      progress: { index: number; total: number }
    }

function plannedEntry(
  entry: SlotEntry,
  slot: SlotName,
  { index: part, entryIds }: ClosePart,
  partCount: number,
): PlannedEntry {
  if (entry.kind === 'code') return { kind: 'code', step: entry.step, part, entryIds }
  const { def } = entry
  return {
    kind: 'task',
    def,
    part,
    entryIds,
    progress: closeTaskProgress(def.task, slot, part, partCount),
  }
}

/** Canon's run order over the slots; throws on a task its order has no place for, or a repeat. */
function planRun(
  slots: CloseAgentSlots,
  chapterEntryIds: readonly string[],
  parts: readonly ClosePart[],
): PlannedEntry[] {
  const partCount = parts.length
  // C4: a chapter-wide entry is part 0, and reads the whole chapter.
  const chapter: ClosePart = { index: 0, entryIds: chapterEntryIds }
  const plan = [
    ...slots.before.map((entry) => plannedEntry(entry, 'before', chapter, partCount)),
    ...parts.flatMap((part) =>
      slots.perPart.map((entry) => plannedEntry(entry, 'perPart', part, partCount)),
    ),
    ...slots.after.map((entry) => plannedEntry(entry, 'after', chapter, partCount)),
  ]
  // C6: the banner's N of M only climbs, so a slot's tasks keep canon's order, each once.
  let last: Extract<PlannedEntry, { kind: 'task' }> | undefined
  for (const planned of plan) {
    if (planned.kind !== 'task') continue
    if (last !== undefined && planned.progress.index <= last.progress.index)
      throw new RangeError(
        `close run order: ${planned.def.task} in part ${planned.part} after ${last.def.task}`,
      )
    last = planned
  }
  return plan
}

/** One planned entry: null goes on to the next, a stop ends the phase. */
async function* runPlannedEntry(
  planned: PlannedEntry,
  agent: AgentContext,
): AsyncGenerator<PhaseEmittedEvent, SlotStop | null, GroupOutcome | undefined> {
  if (agent.phase.abortSignal.aborted) return { status: 'aborted' }
  const { part, entryIds: taskEntryIds } = planned
  if (planned.kind === 'code') {
    const { ledger: _ledger, ...stepAgent } = agent
    const { db, branchId } = agent.phase
    const result = yield* planned.step.run({ ...stepAgent, db, branchId, part, taskEntryIds })
    return result.status === 'completed' ? null : result
  }
  const { def, progress } = planned
  // C6: as the task starts, a task with nothing to show included, so the banner names it.
  yield { type: 'close_task_start', task: def.task, part, ...progress }
  const end = yield* runCloseTask(def, { ...agent, part, taskEntryIds })
  if (end.status === 'aborted') return { status: 'aborted' }
  if (end.status === 'failed') return { status: 'failed', error: end.error }
  return null
}

/**
 * C2 → agent: slots in run order (memory/chapter-close.md → Run order); `before`/`after` are part
 * 0 over the whole chapter, `perPart` runs once per stored part from 1 (C4) over that part's
 * entries. A stopped task keeps what landed; failed/aborted ends.
 */
export async function* closeAgentPhase(
  ctx: PhaseContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult, GroupOutcome | undefined> {
  const range = requireCloseRange(ctx)
  if ('status' in range) return range
  const ledgerRecord = seedCloseLedger(ctx.intermediates)
  const slots = closeAgentSlots()
  // No entry, part, store or model read: a close with no task is its row, stamps and report.
  if (slots.before.length + slots.perPart.length + slots.after.length === 0)
    return { status: 'completed' }
  const cuts = requireCloseParts(ctx)
  if ('status' in cuts) return cuts

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
  const ledger = new CloseLedgerWriter(ledgerRecord, (id) => ids.nameOfId(id), ctx.actionId)
  const entries = await readCloseRangeEntries(ctx.db, ctx.branchId, range)
  const chapterEntryIds = entries.map((entry) => entry.id)
  // Chapter-wide handles: a part's turns keep the numbers they have in the whole chapter.
  ids.showTurns(chapterEntryIds)
  const plan = planRun(slots, chapterEntryIds, closeParts(entries, cuts))
  const agent: AgentContext = {
    endEntryId: range.endEntryId,
    ids,
    survivorOf: (table, id) => ledger.survivorOf(table, id),
    phase: ctx,
    ledger,
    config,
  }

  for (const planned of plan) {
    const stop = yield* runPlannedEntry(planned, agent)
    if (stop) return stop
  }
  return { status: 'completed' }
}
