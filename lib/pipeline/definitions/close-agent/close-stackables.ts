import { and, asc, eq } from 'drizzle-orm'

import type { GroupOutcome, GuardRow, PipelineAction } from '@/lib/actions/types'
import { entities, entityStateSchemaForKind } from '@/lib/db'
import { isJsonObject } from '@/lib/json-object'
import { normalizeStackables, sameStackables } from '@/lib/keyword-terms'

import type { CodeStep, CodeStepContext } from './slots'
import { readRowGuard } from '../../runtime/action-port'
import { emitDeltaGroup } from '../../runtime/emit-group'
import type { PhaseEmittedEvent, PhaseResult } from '../../types'

const STACKABLES_PATH: readonly string[] = ['stackables']

/** A character's stored record; undefined when it holds none, or anything but counts. */
function storedStackables(state: unknown): Record<string, number> | undefined {
  if (!isJsonObject(state) || !isJsonObject(state.stackables)) return undefined
  const entries = Object.entries(state.stackables)
  if (!entries.every((entry): entry is [string, number] => typeof entry[1] === 'number'))
    return undefined
  // fromEntries defines own properties; assigning a `__proto__` key would hit the prototype setter.
  return Object.fromEntries(entries)
}

// Folding can lengthen a key past the schema's bound, and a stackables write is not checked
// against it: the row would land, then every later full-state write for the character is refused.
const stackablesSchema = entityStateSchemaForKind('character').shape.stackables

/**
 * memory/chapter-close.md → 3c: every character's stackables folded to one spelling per fungible,
 * as one group anchored on E. 3c cites no turn, so E's prose is its anchor: a record the user or a
 * later turn wrote after it is skipped whole, or `Gold` could come back beside a user's `gold`.
 */
async function* normalizeRun(
  ctx: CodeStepContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult, GroupOutcome | undefined> {
  const { abortSignal } = ctx.phase
  if (abortSignal.aborted) return { status: 'aborted' }
  const characters = await ctx.db
    .select({ id: entities.id, state: entities.state })
    .from(entities)
    .where(and(eq(entities.branchId, ctx.branchId), eq(entities.kind, 'character')))
    .orderBy(asc(entities.id))
  const stored = new Map(characters.map((row) => [row.id, storedStackables(row.state)]))
  // A plural folds only onto a singular some record on the branch holds, so every record goes in.
  const normalized = normalizeStackables(stored)
  const changed = characters.flatMap(({ id }) => {
    const next = normalized.get(id)
    if (next === undefined || sameStackables(stored.get(id), next)) return []
    return stackablesSchema.safeParse(next).success ? [{ id, next }] : []
  })
  if (changed.length === 0) return { status: 'completed' }

  const guard = await readRowGuard(
    {
      branchId: ctx.branchId,
      endEntryId: ctx.endEntryId,
      proseEntryId: ctx.endEntryId,
      rows: changed.map(({ id }): GuardRow => ({ table: 'entities', id })),
    },
    { db: ctx.phase.db, runInTransaction: ctx.phase.runInTransaction },
  )
  const actions: PipelineAction[] = []
  for (const { id, next } of changed) {
    if (abortSignal.aborted) return { status: 'aborted' }
    const verdicts = guard.row('entities', id)
    if (
      verdicts.userWrote('state', STACKABLES_PATH) ||
      verdicts.laterTurnWrote('state', STACKABLES_PATH)
    )
      continue
    actions.push({
      kind: 'updateEntityStackables',
      source: 'chapter_close',
      payload: { branchId: ctx.branchId, id, stackables: next },
    })
  }
  if (actions.length === 0) return { status: 'completed' }
  if (abortSignal.aborted) return { status: 'aborted' }
  // C1: anchored on E. A code step has no model to tell, so a refusal fails the close.
  const outcome = yield* emitDeltaGroup(actions, ctx.endEntryId)
  if (outcome.status === 'rejected')
    return {
      status: 'failed',
      error: {
        kind: 'action-layer',
        detail: `stackable normalization refused: ${outcome.reason}`,
        tableName: 'entities',
      },
    }
  return { status: 'completed' }
}

/** memory/chapter-close.md → Run order, step 4: first in `before`, no task and no ledger entry. */
export const normalizeStackablesStep: CodeStep = { name: 'stackables', run: normalizeRun }
