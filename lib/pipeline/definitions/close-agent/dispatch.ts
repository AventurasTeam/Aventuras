import type { GroupOutcome, GuardRow, PipelineAction } from '@/lib/actions/types'
import type { ToolStepCall } from '@/lib/ai'
import { logger } from '@/lib/diagnostics'
import { isJsonObject } from '@/lib/json-object'

import { commonChecks, type ReadSet } from './common-checks'
import { nameCloseProse, withHandlesDeep, type CloseIds } from './ids'
import type { CloseLedgerWriter } from './ledger'
import {
  resolveIdArgs,
  tableOfId,
  type CloseTool,
  type ReadTool,
  type ReportRow,
  type ToolContext,
  type WritePlan,
  type WriteTool,
} from './tool'
import { assertPlanShape, modelAnswer, rejectedWhole, verdictOf, type ToolVerdict } from './verdict'
import { readRowGuard } from '../../runtime/action-port'
import { emitDeltaGroup } from '../../runtime/emit-group'
import type { PhaseContext, PhaseEmittedEvent } from '../../types'

export type DispatchContext = ToolContext & {
  readonly phase: PhaseContext
  readonly chapterEntryIds: readonly string[]
  readonly readSet: ReadSet
  readonly ledger: CloseLedgerWriter
}

export type ToolAnswer = { toolCallId: string; toolName: string; output: unknown }

type Write = Extract<WritePlan, { kind: 'write' }>
type Survivor = NonNullable<ToolVerdict['survivor']>
type CallRecord = {
  rows: readonly ReportRow[]
  turns: readonly string[]
  verdict: ToolVerdict
  values?: Readonly<Record<string, unknown>>
  survivor?: Survivor
}

// A tool sees the close, never the ledger or the read set it is judged by.
function toolContextOf(ctx: DispatchContext): ToolContext {
  return {
    db: ctx.db,
    branchId: ctx.branchId,
    endEntryId: ctx.endEntryId,
    task: ctx.task,
    part: ctx.part,
    ids: ctx.ids,
    readFields: ctx.readFields,
    survivorOf: ctx.survivorOf,
  }
}

function answerTo(call: ToolStepCall, output: unknown, ids: CloseIds): ToolAnswer {
  return {
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    output: withHandlesDeep(output, ids),
  }
}

function namedWhy(args: Readonly<Record<string, unknown>>, ids: CloseIds): string {
  return typeof args.why === 'string' ? nameCloseProse({ why: args.why }, ids).why : ''
}

// A call refused before its checks passed records its in-chapter turns, as an ok does.
function turnsInChapter(raw: unknown, ctx: DispatchContext): string[] {
  if (!Array.isArray(raw)) return []
  const ids = new Set(
    raw.map((handle) => (typeof handle === 'string' ? ctx.ids.idOf(handle) : undefined)),
  )
  return ctx.chapterEntryIds.filter((id) => ids.has(id))
}

function rowsNamed(rows: readonly GuardRow[], ids: CloseIds): ReportRow[] {
  return rows.map(({ table, id }) => ({ table, id, name: ids.nameOfId(id) ?? '' }))
}

function recordWrite(
  ctx: DispatchContext,
  toolName: string,
  args: Readonly<Record<string, unknown>>,
  entry: CallRecord,
): void {
  const { verdict } = entry
  ctx.ledger.record({
    task: ctx.task,
    part: ctx.part,
    tool: toolName,
    rows: [...entry.rows],
    why: namedWhy(args, ctx.ids),
    turns: [...entry.turns],
    result: verdict.result,
    ...(verdict.reason === undefined ? {} : { reason: verdict.reason }),
    ...(entry.values === undefined ? {} : { values: entry.values }),
    ...(verdict.skippedFields.length === 0
      ? {}
      : { skippedFields: verdict.skippedFields.map((skipped) => ({ ...skipped })) }),
    ...(entry.survivor === undefined ? {} : { survivor: entry.survivor }),
  })
}

function createsRow(action: PipelineAction, id: string): boolean {
  const payload: unknown = 'payload' in action ? action.payload : undefined
  return isJsonObject(payload) && isJsonObject(payload.entry) && payload.entry.id === id
}

function landedCreate(
  plan: Write,
  outcome: GroupOutcome | null,
): { id: string; name: string } | undefined {
  const id = plan.createdId
  if (id === undefined || outcome?.status !== 'ok') return undefined
  const { outcomes } = outcome
  const landed = plan.actions.some(
    (planned, index) => outcomes[index]?.status === 'landed' && createsRow(planned.action, id),
  )
  if (!landed) return undefined
  return { id, name: plan.rows.find((row) => row.id === id)?.name ?? '' }
}

// C4: a restated path wrote nothing, so the report holds no value for it, unless another action
// or a lost field carries the same path: that one landed it or leaves it proposed.
function landedOrProposed(
  plan: Write,
  outcome: GroupOutcome | null,
): Readonly<Record<string, unknown>> {
  if (outcome?.status !== 'ok') return plan.values
  const { outcomes } = outcome
  const restated = new Set<string>()
  const carried = new Set(plan.lost.map(({ field }) => field))
  plan.actions.forEach((planned, index) => {
    const one = outcomes[index]
    const into = one?.status === 'noop' && one.mark === 'restated' ? restated : carried
    for (const field of planned.fields) into.add(field)
  })
  return Object.fromEntries(
    Object.entries(plan.values).filter(([field]) => !restated.has(field) || carried.has(field)),
  )
}

// The orchestrator logs a single action's noop; a group's outcome is the phase's to read.
function logOutcome(
  tool: WriteTool,
  actions: readonly PipelineAction[],
  outcome: GroupOutcome,
  ctx: DispatchContext,
): void {
  const at = { actionId: ctx.phase.actionId }
  if (outcome.status === 'rejected') {
    logger.debug(
      'memory.close_tool_group_rejected',
      {
        tool: tool.name,
        kinds: actions.map(({ kind }) => kind),
        reason: outcome.reason,
        ...(outcome.code === undefined ? {} : { code: outcome.code }),
      },
      at,
    )
    return
  }
  outcome.outcomes.forEach((one, index) => {
    if (one.status !== 'noop') return
    logger.debug(
      'memory.close_tool_action_noop',
      {
        tool: tool.name,
        kind: actions[index]?.kind,
        reason: one.reason,
        ...(one.mark === undefined ? {} : { mark: one.mark }),
      },
      at,
    )
  })
}

// C1: a close writes as chapter_close; another source counts as that writer's under precedence.
function assertCloseSource(tool: WriteTool, plan: Write): void {
  for (const { action } of plan.actions)
    if (action.source !== 'chapter_close')
      throw new Error(
        `${tool.name} plans a ${action.kind} as ${action.source}; a close writes as chapter_close`,
      )
}

async function readCall(
  tool: ReadTool,
  args: Record<string, unknown>,
  ctx: DispatchContext,
): Promise<unknown> {
  const answer = await tool.read(args, toolContextOf(ctx))
  ctx.readSet.add(answer.read)
  ctx.ledger.record({
    task: ctx.task,
    part: ctx.part,
    tool: tool.name,
    rows: answer.rows.map((row) => ({ ...row })),
    why: '',
    turns: [],
    result: 'ok',
  })
  return answer.output
}

async function* writeCall(
  tool: WriteTool,
  args: Record<string, unknown>,
  named: readonly GuardRow[],
  ctx: DispatchContext,
): AsyncGenerator<PhaseEmittedEvent, unknown, GroupOutcome | undefined> {
  const check = commonChecks({ turns: args.turns, why: args.why }, named, {
    ids: ctx.ids,
    chapterEntryIds: ctx.chapterEntryIds,
    readSet: ctx.readSet,
  })
  if (!check.ok) {
    const verdict = rejectedWhole(check.reason, [], ctx)
    recordWrite(ctx, tool.name, args, {
      rows: rowsNamed(named, ctx.ids),
      turns: turnsInChapter(args.turns, ctx),
      verdict,
    })
    return modelAnswer(verdict, {}, ctx.ids)
  }

  const { proseEntryId } = check
  const plan = await tool.plan(nameCloseProse(args, ctx.ids), {
    ...toolContextOf(ctx),
    turns: check.turns,
    proseEntryId,
    guard: (rows) =>
      readRowGuard(
        { branchId: ctx.branchId, endEntryId: ctx.endEntryId, proseEntryId, rows },
        { db: ctx.phase.db, runInTransaction: ctx.phase.runInTransaction },
      ),
    actionId: ctx.phase.actionId,
  })

  if (plan.kind === 'refused') {
    const verdict = rejectedWhole(plan.reason, plan.rows, ctx)
    recordWrite(ctx, tool.name, args, {
      rows: plan.rows,
      turns: check.turns,
      verdict,
      values: plan.values,
    })
    return modelAnswer(verdict, plan.note === undefined ? {} : { note: plan.note }, ctx.ids)
  }

  assertPlanShape(plan)
  assertCloseSource(tool, plan)
  let outcome: GroupOutcome | null = null
  if (plan.actions.length > 0) {
    const actions = plan.actions.map(({ action }) => action)
    // C1: a close's group anchors on E, whichever turns it cites.
    outcome = yield* emitDeltaGroup(actions, ctx.endEntryId)
    logOutcome(tool, actions, outcome, ctx)
  }
  const verdict = verdictOf(plan, outcome, { survivorOf: ctx.survivorOf })
  const created = landedCreate(plan, outcome)
  if (created !== undefined) {
    ctx.ids.show(created.id, created.name)
    // A row the task made is one it knows the fields of, so a later write to it needs no read_row.
    const table = tableOfId(created.id)
    if (table !== null) ctx.readSet.add([{ table, id: created.id }])
  }
  recordWrite(ctx, tool.name, args, {
    rows: plan.rows,
    turns: check.turns,
    verdict,
    values: landedOrProposed(plan, outcome),
    // A gone row's survivor goes to the model's answer; ok carries one only if something landed.
    ...(verdict.result === 'ok' && verdict.survivor !== undefined
      ? { survivor: verdict.survivor }
      : {}),
  })
  return modelAnswer(verdict, created === undefined ? {} : { createdId: created.id }, ctx.ids)
}

/**
 * chapter-close.md → Tools and writes: one valid call, answered; a write lands as one group
 * anchored on E (C1) once its ids resolve, its checks pass and its plan reads ahead.
 */
export async function* dispatchToolCall(
  call: ToolStepCall,
  tool: CloseTool,
  ctx: DispatchContext,
): AsyncGenerator<PhaseEmittedEvent, ToolAnswer, GroupOutcome | undefined> {
  const resolved = resolveIdArgs(call.input, tool, ctx.ids)
  if (!resolved.ok) {
    const verdict = rejectedWhole(resolved.reason, [], ctx)
    // A read has nothing for the review to show, so only a write's miss joins the ledger.
    if (tool.kind === 'write')
      recordWrite(ctx, tool.name, call.input, {
        rows: [],
        turns: turnsInChapter(call.input.turns, ctx),
        verdict,
      })
    return answerTo(call, modelAnswer(verdict, {}, ctx.ids), ctx.ids)
  }
  if (tool.kind === 'read') return answerTo(call, await readCall(tool, resolved.args, ctx), ctx.ids)
  const output = yield* writeCall(tool, resolved.args, resolved.named, ctx)
  return answerTo(call, output, ctx.ids)
}
