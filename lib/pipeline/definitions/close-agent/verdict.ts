import { USER_EDITED_SINCE_PROSE, type ActionOutcome, type GroupOutcome } from '@/lib/actions/types'

import type { CloseIds } from './ids'
import type { ReportRow, ToolContext, WritePlan } from './tool'

/** C4's stable reasons a close adds beside USER_EDITED_SINCE_PROSE. */
export const CLOSE_REASON = { laterTurn: 'later-turn', rowGone: 'row-gone' } as const

// registry.ts's TARGET_NOT_FOUND, which lib/pipeline can't import: the update and delete
// handlers' hard not-found, which refuses the whole group.
const TARGET_NOT_FOUND = 'not-found'

export type ToolVerdict = {
  result: 'ok' | 'rejected' | 'skipped'
  /** Why the call as a whole didn't land (rejected / skipped). */
  reason?: string
  /** Delta paths that landed. */
  landed: readonly string[]
  /** Fields lost beside a landed one, each with its reason (C4 skippedFields). */
  skippedFields: readonly { field: string; reason: string }[]
  survivor?: { table: string; id: string }
}

type WritingPlan = Extract<WritePlan, { kind: 'write' }>
type Survivors = { survivorOf: ToolContext['survivorOf'] }
type Loss = { fields: readonly string[]; reason: string; refused: boolean }

// C11: a noop neither marked nor kept by precedence is a refusal, so nothing unlanded reads as ok.
function noopLoss(
  outcome: Extract<ActionOutcome, { status: 'noop' }>,
  fields: readonly string[],
): Loss | null {
  if (outcome.mark === 'restated') return null
  if (outcome.mark === 'gone') return { fields, reason: CLOSE_REASON.rowGone, refused: true }
  if (outcome.reason === USER_EDITED_SINCE_PROSE)
    return { fields, reason: outcome.reason, refused: false }
  return { fields, reason: outcome.reason, refused: true }
}

// C4 reads landed as values less skippedFields, so a path in both would hide one or the other.
function settleOverlap(landed: ReadonlySet<string>, losses: readonly Loss[]): void {
  for (const { fields } of losses)
    for (const field of fields)
      if (landed.has(field)) throw new Error(`verdictOf: ${field} both landed and was lost`)
}

function survivorAmong(rows: readonly ReportRow[], { survivorOf }: Survivors) {
  for (const row of rows) {
    const survivor = survivorOf(row.table, row.id)
    if (survivor !== undefined) return survivor
  }
  return undefined
}

/** A refusal of the whole call; a gone row names where it went, if a landed merge took it. */
export function rejectedWhole(
  reason: string,
  rows: readonly ReportRow[],
  ctx: Survivors,
): ToolVerdict {
  const survivor = reason === CLOSE_REASON.rowGone ? survivorAmong(rows, ctx) : undefined
  return {
    result: 'rejected',
    reason,
    landed: [],
    skippedFields: [],
    ...(survivor === undefined ? {} : { survivor }),
  }
}

/** Every planned action names the delta paths it writes, or its outcome reads as nothing. */
export function assertPlanShape(plan: WritingPlan): void {
  for (const { action, fields } of plan.actions)
    if (fields.length === 0) throw new Error(`a planned ${action.kind} names no delta path`)
}

/**
 * C11: one result for a write from its plan and its group's outcome (null when no group was
 * emitted). Any action landed is `ok` naming what didn't, restated fields aside; else a refusal or
 * a gone row is `rejected`, a protected field `skipped`, and nothing lost `ok`, nothing written.
 */
export function verdictOf(
  plan: WritingPlan,
  outcome: GroupOutcome | null,
  ctx: Survivors,
): ToolVerdict {
  assertPlanShape(plan)
  if (outcome?.status === 'rejected') {
    const reason = outcome.code === TARGET_NOT_FOUND ? CLOSE_REASON.rowGone : outcome.reason
    return rejectedWhole(reason, plan.rows, ctx)
  }
  const outcomes = outcome?.outcomes ?? []
  if (outcomes.length !== plan.actions.length)
    throw new Error(
      `verdictOf: ${outcomes.length} outcomes for ${plan.actions.length} planned actions`,
    )
  let anyLanded = false
  const landed = new Set<string>()
  const losses: Loss[] = []
  for (const [i, { fields }] of plan.actions.entries()) {
    const actionOutcome = outcomes[i]
    if (actionOutcome.status === 'landed') {
      anyLanded = true
      for (const field of fields) landed.add(field)
      continue
    }
    const loss = noopLoss(actionOutcome, fields)
    if (loss !== null) losses.push(loss)
  }
  for (const { field, reason, kind } of plan.lost)
    losses.push({ fields: [field], reason, refused: kind === 'refused' })
  settleOverlap(landed, losses)

  if (anyLanded) {
    const skipped = new Map<string, string>()
    for (const { fields, reason } of losses)
      for (const field of fields) if (!skipped.has(field)) skipped.set(field, reason)
    return {
      result: 'ok',
      landed: [...landed],
      skippedFields: [...skipped].map(([field, reason]) => ({ field, reason })),
      ...(plan.survivor === undefined ? {} : { survivor: plan.survivor }),
    }
  }
  const refusal = losses.find((loss) => loss.refused)
  if (refusal !== undefined) return rejectedWhole(refusal.reason, plan.rows, ctx)
  const protection = losses.find((loss) => !loss.refused)
  if (protection !== undefined)
    return { result: 'skipped', reason: protection.reason, landed: [], skippedFields: [] }
  return { result: 'ok', landed: [], skippedFields: [] }
}

const NOTES = new Map<string, string>([
  [
    USER_EDITED_SINCE_PROSE,
    'The user edited this after the cited turns; their value stands. Do not write it again.',
  ],
  [CLOSE_REASON.laterTurn, 'A later turn wrote this; its value stands. Do not write it again.'],
  [CLOSE_REASON.rowGone, 'The row is gone; do not write to it again.'],
])

type ModelAnswer = {
  result: ToolVerdict['result']
  /** A create's new row, as its handle. */
  id?: string
  reason?: string
  /** What to do, for a stable reason. */
  note?: string
  survivor?: string
  notWritten?: { field: string; reason: string; note?: string }[]
}

/** The tool result the model reads: handles only, and what to do about a stable reason. */
export function modelAnswer(
  verdict: ToolVerdict,
  extra: { createdId?: string },
  ids: CloseIds,
): unknown {
  const survivor = verdict.survivor === undefined ? undefined : ids.withHandles(verdict.survivor.id)
  const answer: ModelAnswer = { result: verdict.result }
  if (verdict.result === 'ok' && extra.createdId !== undefined)
    answer.id = ids.withHandles(extra.createdId)
  if (verdict.reason !== undefined) {
    answer.reason = ids.withHandles(verdict.reason)
    const note =
      verdict.reason === CLOSE_REASON.rowGone && survivor !== undefined
        ? `The row was merged into ${survivor}; write to ${survivor} instead.`
        : NOTES.get(verdict.reason)
    if (note !== undefined) answer.note = note
  }
  if (survivor !== undefined) answer.survivor = survivor
  if (verdict.skippedFields.length > 0)
    answer.notWritten = verdict.skippedFields.map(({ field, reason }) => {
      const note = NOTES.get(reason)
      return { field, reason: ids.withHandles(reason), ...(note === undefined ? {} : { note }) }
    })
  return answer
}
