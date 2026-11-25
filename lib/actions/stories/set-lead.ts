import { and, asc, eq } from 'drizzle-orm'

import { branches, entities, stories, type DbCtx } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { generateId } from '@/lib/ids'
import { generationStore, isUserEditBlocked } from '@/lib/stores'
import { needsLead } from '@/lib/world'

import { applyDeltaActionGroup, DELTA_REJECTION } from '../delta/apply-delta-action'
import { withKeyLock } from '../delta/key-lock'
import type { PipelineAction } from '../types'

export const LEAD_REJECTION = {
  inFlight: 'in-flight',
  draftStory: 'draft-story',
  wrongBranch: 'wrong-branch',
  notCharacter: 'not-character',
  notActive: 'not-active',
  needsLead: 'needs-lead',
  failed: 'failed',
} as const

export type LeadRejectionCode = (typeof LEAD_REJECTION)[keyof typeof LEAD_REJECTION]

type LeadCode<K extends keyof typeof LEAD_REJECTION> = (typeof LEAD_REJECTION)[K]
type SharedCode = LeadCode<'inFlight' | 'failed' | 'draftStory'>

type SetLeadRejectionCode = SharedCode | LeadCode<'wrongBranch' | 'notCharacter' | 'notActive'>
type UnsetLeadRejectionCode = SharedCode | LeadCode<'needsLead'>

type LeadRejected<Code extends LeadRejectionCode> = { status: 'rejected'; code: Code }
type LeadResult<Code extends LeadRejectionCode> = { status: 'ok' } | LeadRejected<Code>

export type SetLeadResult = LeadResult<SetLeadRejectionCode>
export type UnsetLeadResult = LeadResult<UnsetLeadRejectionCode>

function refuse<Code extends LeadRejectionCode>(
  branchId: string,
  entityId: string | null,
  code: Code,
  reason?: string,
): LeadRejected<Code> {
  logger.warn('action_layer.lead_rejected', {
    branchId,
    entityId,
    code,
    ...(reason === undefined ? {} : { reason }),
  })
  return { status: 'rejected', code }
}

// Each reads the flagged rows before its group takes their row locks, so two at once on one
// branch would each clear only what the other hadn't flagged yet: they run one at a time.
function queued<Result>(branchId: string, run: () => Promise<Result>): Promise<Result> {
  return withKeyLock(`lead:${branchId}`, run)
}

async function storyOf(branchId: string, ctx: DbCtx) {
  const [owner] = await ctx.db
    .select({ status: stories.status, definition: stories.definition })
    .from(branches)
    .innerJoin(stories, eq(stories.id, branches.storyId))
    .where(eq(branches.id, branchId))
  if (!owner) throw new Error('branch not found')
  return owner
}

async function flaggedIds(branchId: string, ctx: DbCtx): Promise<string[]> {
  const rows = await ctx.db
    .select({ id: entities.id })
    .from(entities)
    .where(and(eq(entities.branchId, branchId), eq(entities.isLead, 1)))
    .orderBy(asc(entities.createdAt), asc(entities.id))
  const ids = rows.map((row) => row.id)
  // C10: logged here too, as the reader refuses a turn on a double before the turn's read logs it.
  if (ids.length > 1) logger.error('action_layer.branch_lead_double', { branchId, ids })
  return ids
}

function leadWrite(branchId: string, id: string, isLead: 0 | 1): PipelineAction {
  return { kind: 'updateEntity', source: 'user_edit', payload: { branchId, id, patch: { isLead } } }
}

// The named branch's gate, its hold included. No await from the check to the group's dispatch:
// a run reserving after the check settles this write before it reads.
async function dispatch(
  branchId: string,
  entityId: string | null,
  actions: readonly PipelineAction[],
  ctx: DbCtx,
): Promise<LeadResult<LeadCode<'inFlight' | 'failed'>>> {
  if (isUserEditBlocked(generationStore.getTxState(), branchId))
    return refuse(branchId, entityId, LEAD_REJECTION.inFlight)
  if (actions.length === 0) return { status: 'ok' }
  const result = await applyDeltaActionGroup(
    actions,
    { actionId: generateId('act'), branchId },
    ctx,
  )
  if (result.status === 'ok') return { status: 'ok' }
  const code =
    result.code === DELTA_REJECTION.reversalInProgress
      ? LEAD_REJECTION.inFlight
      : LEAD_REJECTION.failed
  return refuse(branchId, entityId, code, result.reason)
}

/** data-model.md → The lead: every flagged row on the branch off, then `entityId` on. */
export function setBranchLead(
  branchId: string,
  entityId: string,
  ctx: DbCtx,
): Promise<SetLeadResult> {
  return queued(branchId, async () => {
    const story = await storyOf(branchId, ctx)
    if (story.status === 'draft') return refuse(branchId, entityId, LEAD_REJECTION.draftStory)
    const [target] = await ctx.db
      .select({ kind: entities.kind, status: entities.status })
      .from(entities)
      .where(and(eq(entities.branchId, branchId), eq(entities.id, entityId)))
    if (!target) return refuse(branchId, entityId, LEAD_REJECTION.wrongBranch)
    if (target.kind !== 'character') return refuse(branchId, entityId, LEAD_REJECTION.notCharacter)
    if (target.status !== 'active') return refuse(branchId, entityId, LEAD_REJECTION.notActive)
    const flagged = await flaggedIds(branchId, ctx)
    const actions = [
      ...flagged.filter((id) => id !== entityId).map((id) => leadWrite(branchId, id, 0)),
      ...(flagged.includes(entityId) ? [] : [leadWrite(branchId, entityId, 1)]),
    ]
    return dispatch(branchId, entityId, actions, ctx)
  })
}

/** Clears every flagged row on the branch; offered only on a story that needs no lead. */
export function unsetBranchLead(branchId: string, ctx: DbCtx): Promise<UnsetLeadResult> {
  return queued(branchId, async () => {
    const story = await storyOf(branchId, ctx)
    if (story.status === 'draft') return refuse(branchId, null, LEAD_REJECTION.draftStory)
    // A story with no stored definition can't say it needs none, so the lead stays.
    const { definition } = story
    if (definition == null || needsLead(definition.mode, definition.narration))
      return refuse(branchId, null, LEAD_REJECTION.needsLead)
    const flagged = await flaggedIds(branchId, ctx)
    return dispatch(
      branchId,
      null,
      flagged.map((id) => leadWrite(branchId, id, 0)),
      ctx,
    )
  })
}
