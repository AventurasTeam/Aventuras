import {
  TARGET_NOT_FOUND,
  USER_EDITED_SINCE_PROSE,
  type ActionOutcome,
  type GroupOutcome,
} from '@/lib/actions/types'

import type { CloseIds } from './ids'
import type { PlannedAction, ReportRow, ToolContext, WritePlan } from './tool'

/** C4's stable reasons a close adds beside USER_EDITED_SINCE_PROSE. */
export const CLOSE_REASON = { laterTurn: 'later-turn', rowGone: 'row-gone' } as const

type NotWritten = { field: string; row: string; reason: string }
type Skipped = { field: string; reason: string }
type Survivor = { table: string; id: string }

/**
 * C11: what each result carries. A call where nothing landed lists its fields, each with its own
 * reason, only when they don't all share the call's; a call refused whole lists none.
 */
export type ToolVerdict =
  | {
      result: 'ok'
      reason?: never
      /** Delta paths that landed. */
      landed: readonly string[]
      /** Lost paths that landed on no row, each with its first loss's reason (C4 skippedFields). */
      skippedFields: readonly Skipped[]
      /**
       * The model's own list (C11): every loss, one entry per row and field, a path that landed
       * on another row included. Absent when empty; never in the ledger.
       */
      notWritten?: readonly NotWritten[]
      /** A landed merge's kept row. */
      survivor?: Survivor
    }
  | {
      result: 'rejected'
      /** The first refusal's. */
      reason: string
      landed: readonly []
      skippedFields: readonly Skipped[]
      notWritten?: readonly NotWritten[]
      /** Where a gone row went, when a landed merge took it. */
      survivor?: Survivor
    }
  | {
      result: 'skipped'
      /** The first protection's. */
      reason: string
      landed: readonly []
      skippedFields: readonly Skipped[]
      notWritten?: readonly NotWritten[]
      survivor?: never
    }
/** Refused whole, by the common checks, an unresolved id, its plan or its group: no field named. */
export type RefusedWhole = Extract<ToolVerdict, { result: 'rejected' }> & {
  skippedFields: readonly []
  notWritten?: never
}

type WritingPlan = Extract<WritePlan, { kind: 'write' }>
type Survivors = { survivorOf: ToolContext['survivorOf'] }
type Loss = { fields: readonly string[]; row: string; reason: string; refused: boolean }

// C11: a noop neither marked nor kept by precedence is a refusal, so nothing unlanded reads as ok.
function noopLoss(
  outcome: Extract<ActionOutcome, { status: 'noop' }>,
  { fields, row }: PlannedAction,
): Loss | null {
  if (outcome.mark === 'restated') return null
  if (outcome.mark === 'gone') return { fields, row, reason: CLOSE_REASON.rowGone, refused: true }
  if (outcome.reason === USER_EDITED_SINCE_PROSE)
    return { fields, row, reason: outcome.reason, refused: false }
  return { fields, row, reason: outcome.reason, refused: true }
}

// C4 reads landed as values less skippedFields, so a path that landed anywhere stays out of
// skippedFields; the model's list still names each of its losses by row.
function settleLosses(
  landed: ReadonlySet<string>,
  losses: readonly Loss[],
): { skippedFields: readonly Skipped[]; notWritten?: readonly NotWritten[] } {
  const skipped = new Map<string, string>()
  const notWritten = new Map<string, NotWritten>()
  for (const { fields, row, reason } of losses)
    for (const field of fields) {
      if (!landed.has(field) && !skipped.has(field)) skipped.set(field, reason)
      const key = JSON.stringify([row, field])
      if (!notWritten.has(key)) notWritten.set(key, { field, row, reason })
    }
  return {
    skippedFields: [...skipped].map(([field, reason]) => ({ field, reason })),
    ...(notWritten.size === 0 ? {} : { notWritten: [...notWritten.values()] }),
  }
}

// Nothing landed: the call's reason says it all unless a field was lost for another.
function ownReasons(
  reason: string,
  losses: readonly Loss[],
): { skippedFields: readonly Skipped[]; notWritten?: readonly NotWritten[] } {
  if (losses.every((loss) => loss.reason === reason)) return { skippedFields: [] }
  return settleLosses(new Set(), losses)
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
): RefusedWhole {
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
 * a gone row is `rejected`, a protected field `skipped`, each with the first such loss's reason,
 * and nothing lost `ok`, nothing written.
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
  for (const [i, planned] of plan.actions.entries()) {
    const actionOutcome = outcomes[i]
    if (actionOutcome.status === 'landed') {
      anyLanded = true
      for (const field of planned.fields) landed.add(field)
      continue
    }
    const loss = noopLoss(actionOutcome, planned)
    if (loss !== null) losses.push(loss)
  }
  for (const { field, reason, row, kind } of plan.lost)
    losses.push({ fields: [field], row, reason, refused: kind === 'refused' })

  if (anyLanded) {
    return {
      result: 'ok',
      landed: [...landed],
      ...settleLosses(landed, losses),
      ...(plan.survivor === undefined ? {} : { survivor: plan.survivor }),
    }
  }
  const refusal = losses.find((loss) => loss.refused)
  if (refusal !== undefined)
    return {
      ...rejectedWhole(refusal.reason, plan.rows, ctx),
      ...ownReasons(refusal.reason, losses),
    }
  const protection = losses.find((loss) => !loss.refused)
  if (protection !== undefined)
    return {
      result: 'skipped',
      reason: protection.reason,
      landed: [],
      ...ownReasons(protection.reason, losses),
    }
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
  notWritten?: { field: string; row: string; reason: string; note?: string }[]
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
  if (verdict.notWritten !== undefined && verdict.notWritten.length > 0)
    answer.notWritten = verdict.notWritten.map(({ field, row, reason }) => {
      const note = NOTES.get(reason)
      return {
        field,
        row: ids.withHandles(row),
        reason: ids.withHandles(reason),
        ...(note === undefined ? {} : { note }),
      }
    })
  return answer
}
