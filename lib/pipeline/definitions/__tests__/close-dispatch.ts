import type { GroupOutcome, GuardRow } from '@/lib/actions/types'
import type { CloseTask } from '@/lib/db'

import type { CloseFixture } from './close-fixture'
import { expectRan } from '../../__tests__/harness'
import { definePipeline } from '../../authoring/define'
import { getPipelineSafe } from '../../authoring/registry'
import { pipelineEventBus } from '../../runtime/event-bus'
import { runPipeline } from '../../runtime/orchestrator'
import type {
  PhaseContext,
  PhaseEmittedEvent,
  PhaseResult,
  PipelineEvent,
  TxResult,
} from '../../types'
import { createReadSet, type ReadSet } from '../close-agent/common-checks'
import { dispatchToolCall, type DispatchContext } from '../close-agent/dispatch'
import type { CloseIds } from '../close-agent/ids'
import { CloseLedgerWriter } from '../close-agent/ledger'
import { tableOfId, type CloseTool, type ReadFields } from '../close-agent/tool'
import {
  closeClusterOf,
  closeIdsOf,
  seedCloseLedger,
  setCloseClusters,
} from '../close-intermediates'
import type { CloseLedger } from '../intermediates'

/** A row the task's start showed: handed its handle in order, and read unless `seeds` is given. */
export type ShownRow = GuardRow & {
  name: string
  /** A shown awareness row's pin as the start read it: null for none; absent shows no pin. */
  startPin?: number | null
}
/** One model call; `part` runs it as that part of the task, the run's own when absent. */
export type ScriptedCall = { toolName: string; input: Record<string, unknown>; part?: number }
export type DispatchTurns = {
  endEntryId: string
  taskEntryIds: readonly string[]
  /** 1 unless given; 0 is a chapter-wide task. */
  part?: number
  /** The turns handed handles; the task's own unless given. */
  chapterEntryIds?: readonly string[]
}
/** Runs once the run's ids and ledger exist, before any call: earlier tasks' ledger rows. */
export type DispatchSetup = (ids: CloseIds, ledger: CloseLedgerWriter) => void
export type DispatchRun = {
  result: TxResult
  /** Each call's answer to the model, in order. */
  answers: unknown[]
  /** The ledger: what `setup` recorded, then each scripted call. */
  calls: CloseLedger['calls']
  events: PipelineEvent[]
  ids: CloseIds
  readSet: ReadSet
}

type DispatchSpec = {
  task: CloseTask
  tools: Readonly<Record<string, CloseTool>>
  shown: readonly ShownRow[]
  calls: readonly ScriptedCall[]
  turns: DispatchTurns
  readFields?: ReadFields
  /** The read set the start seeded; `shown` when absent. */
  seeds?: readonly GuardRow[]
  setup?: DispatchSetup
  /** The run's expected outcome; `completed` when absent. */
  outcome?: TxResult['outcome']
  /** The range embed's clusters (happening ids), parked as the close parks them; none unless given. */
  clusters?: readonly (readonly string[])[]
}

const KIND = 'close-dispatch-test'

type Staged = {
  spec: DispatchSpec
  answers: unknown[]
  ledger?: CloseLedger
  ids?: CloseIds
  readSet?: ReadSet
}

let staged: Staged | undefined

// Stands in for the agent phase: the run's ids and ledger, the start's rows shown and read.
async function* dispatchPhase(
  phase: PhaseContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult, GroupOutcome | undefined> {
  const run = staged
  if (run === undefined) throw new Error('runDispatchCalls: no run staged')
  const { spec } = run
  const { turns } = spec
  const ids = closeIdsOf(phase.intermediates)
  ids.showTurns(turns.chapterEntryIds ?? turns.taskEntryIds)
  // An awareness row's handle is an aw one, which takes no name.
  for (const { table, id, name, startPin } of spec.shown)
    if (table === 'happening_awareness') ids.showAwareness(id, startPin)
    else ids.show(id, name)
  const ledger = seedCloseLedger(phase.intermediates)
  const writer = new CloseLedgerWriter(ledger, (id) => ids.nameOfId(id), phase.actionId)
  spec.setup?.(ids, writer)
  const readSet = createReadSet()
  readSet.add(spec.seeds ?? spec.shown)
  run.ledger = ledger
  run.ids = ids
  run.readSet = readSet
  if (spec.clusters !== undefined) setCloseClusters(phase.intermediates, spec.clusters)
  const ctx: DispatchContext = {
    db: phase.db,
    branchId: phase.branchId,
    endEntryId: turns.endEntryId,
    task: spec.task,
    part: turns.part ?? 1,
    ids,
    readFields: spec.readFields ?? {},
    survivorOf: (table, id) => writer.survivorOf(table, id),
    clusterOf: (happeningId) => closeClusterOf(phase.intermediates, happeningId),
    landedCalls: (tool) => writer.landedCalls(tool),
    phase,
    taskEntryIds: turns.taskEntryIds,
    readSet,
    ledger: writer,
  }
  for (const [index, { toolName, input, part }] of spec.calls.entries()) {
    const tool = spec.tools[toolName]
    if (tool === undefined) throw new Error(`runDispatchCalls: no tool ${toolName}`)
    const answer = yield* dispatchToolCall(
      { toolCallId: `call_${index + 1}`, toolName, input },
      tool,
      part === undefined ? ctx : { ...ctx, part },
    )
    run.answers.push(answer.output)
  }
  return { status: 'completed' }
}

/** `rows` as shown rows, each one's table read off its id's prefix. */
export function shownOf(rows: readonly { id: string; name: string }[]): ShownRow[] {
  return rows.map(({ id, name }) => {
    const table = tableOfId(id)
    if (table === null) throw new Error(`shownOf: no table for ${id}`)
    return { table, id, name }
  })
}

/**
 * Runs `calls` in order through dispatchToolCall in one close-like run on `fx`, as `task` over
 * `turns`, `shown` shown in order and read unless `seeds` names the read set.
 */
export async function runDispatchCalls(fx: CloseFixture, spec: DispatchSpec): Promise<DispatchRun> {
  if (getPipelineSafe(KIND) === undefined)
    definePipeline({
      kind: KIND,
      phases: [{ name: 'agent', run: dispatchPhase }],
      affordance: 'invisible',
      gateBehavior: 'hard-gate',
      concurrencyPolicy: {},
    })
  const run: Staged = { spec, answers: [] }
  const events: PipelineEvent[] = []
  const unsubscribe = pipelineEventBus.subscribeAll((event) => {
    events.push(event)
  })
  staged = run
  try {
    const result = expectRan(
      await runPipeline(KIND, {
        storyId: fx.storyId,
        branchId: fx.branchId,
        db: fx.ctx.db,
        runInTransaction: fx.ctx.runInTransaction,
      }),
    )
    const expected = spec.outcome ?? 'completed'
    if (result.outcome !== expected)
      throw new Error(`the run ${result.outcome}, not ${expected}: ${JSON.stringify(result.error)}`)
    const { ledger, ids, readSet } = run
    if (ledger === undefined || ids === undefined || readSet === undefined)
      throw new Error('runDispatchCalls: the phase never ran')
    return { result, answers: run.answers, calls: ledger.calls, events, ids, readSet }
  } finally {
    unsubscribe()
    staged = undefined
  }
}
