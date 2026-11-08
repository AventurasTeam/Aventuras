import type { GroupOutcome } from '@/lib/actions/types'
import type { ResolveModelConfig } from '@/lib/ai'
import { appSettingsStore, currentStoryStore } from '@/lib/stores'

import { readCloseRangeEntries } from './chapter-close-metadata-call'
import { CloseLedgerWriter } from './close-agent/ledger'
import { closeParts } from './close-agent/parts'
import { closeTaskProgress } from './close-agent/progress'
import { runCloseTask } from './close-agent/run-task'
import { closeAgentSlots, type CloseAgentSlots, type SlotEntry } from './close-agent/slots'
import type { TaskRunContext } from './close-agent/task'
import { closeIdsOf, requireCloseRange, seedCloseLedger } from './close-intermediates'
import { storesHoldBranch } from './stores-hold-branch'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult } from '../types'

type SlotName = keyof CloseAgentSlots
/** What every entry of one run shares; each entry adds its task, part and read fields. */
type AgentContext = Omit<TaskRunContext, 'task' | 'part' | 'readFields'>
type SlotStop = Exclude<PhaseResult, { status: 'completed' }>

/** One slot entry: null goes on to the next, a stop ends the phase. */
async function* runSlotEntry(
  entry: SlotEntry,
  agent: AgentContext,
  at: { slot: SlotName; part: number; partCount: number },
): AsyncGenerator<PhaseEmittedEvent, SlotStop | null, GroupOutcome | undefined> {
  if (agent.phase.abortSignal.aborted) return { status: 'aborted' }
  if (entry.kind === 'code') {
    const result = yield* entry.step.run({ ...agent, part: at.part })
    return result.status === 'completed' ? null : result
  }
  const { def } = entry
  // C6: as the task starts, a task with nothing to show included, so the banner names it.
  yield {
    type: 'close_task_start',
    task: def.task,
    part: at.part,
    ...closeTaskProgress(def.task, at.part, at.partCount),
  }
  const end = yield* runCloseTask(def, {
    ...agent,
    task: def.task,
    part: at.part,
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
  const parts = closeParts(entries)
  const partCount = parts.length
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

  for (const entry of slots.before) {
    const stop = yield* runSlotEntry(entry, agent, { slot: 'before', part: 0, partCount })
    if (stop) return stop
  }
  for (const part of parts) {
    for (const entry of slots.perPart) {
      const stop = yield* runSlotEntry(entry, agent, {
        slot: 'perPart',
        part: part.index,
        partCount,
      })
      if (stop) return stop
    }
  }
  for (const entry of slots.after) {
    const stop = yield* runSlotEntry(entry, agent, { slot: 'after', part: 0, partCount })
    if (stop) return stop
  }
  return { status: 'completed' }
}
