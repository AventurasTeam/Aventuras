import { and, eq, getTableColumns, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'

import { branchCopyOps, branches, pipelineRuns, stories, type SqlOp } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { isStorySwapPending, readStorySwapPending, storedSwapTarget } from '@/lib/embedder-swap'
import { generateId } from '@/lib/ids'
import {
  generationStore,
  readStoryBranches,
  rehydrateStories,
  type BranchRow,
  type TxState,
} from '@/lib/stores'

import { readUnfinishedRuns } from '../delta/unfinished-runs'
import type { DbCtx } from '../types'

export const DUPLICATE_REFUSAL = {
  missing: 'missing',
  empty: 'empty',
  draft: 'draft',
  swapPending: 'swap-pending',
  runRegistered: 'run-registered',
  branchHeld: 'branch-held',
  unfinishedRun: 'unfinished-run',
} as const
export type DuplicateRefusalCode = (typeof DUPLICATE_REFUSAL)[keyof typeof DUPLICATE_REFUSAL]
/** One branch, or the whole tree. */
export type DuplicateBranch = 'all' | { readonly branchId: string }
export type DuplicateCheck =
  | { status: 'ok' }
  | { status: 'rejected'; code: Exclude<DuplicateRefusalCode, 'empty'> }
export type DuplicateStoryInput = {
  readonly storyId: string
  readonly title: string
  readonly branch: DuplicateBranch
}
export type DuplicateStoryResult =
  | { status: 'duplicated'; storyId: string }
  | { status: 'rejected'; code: DuplicateRefusalCode }

type CheckRefusal = Extract<DuplicateCheck, { status: 'rejected' }>

const refused = (code: CheckRefusal['code']): CheckRefusal => ({ status: 'rejected', code })

// RunState.storyId is nullable, so a run also counts by its branch.
function runOnStory(txState: TxState, storyId: string, branchIds: readonly string[]): boolean {
  return [...txState.runs.values()].some(
    (run) => run.storyId === storyId || branchIds.includes(run.branchId),
  )
}

/**
 * data-model.md → Story duplicate, Refused before any write: the first refusal for copying
 * `branch`, or ok. `missing`: no such story, or no branch of it to copy.
 */
export async function checkStoryDuplicate(
  storyId: string,
  branch: DuplicateBranch,
  ctx: Pick<DbCtx, 'db'>,
): Promise<DuplicateCheck> {
  const [story] = await ctx.db
    .select({ status: stories.status })
    .from(stories)
    .where(eq(stories.id, storyId))
  if (story == null) return refused(DUPLICATE_REFUSAL.missing)
  const state = sql<string | null>`json_extract(${branches.classifierStatus}, '$.state')`
  // Parsed on the copied branches only: a sibling's malformed status can't fail this copy.
  const onStory = await ctx.db
    .select({
      id: branches.id,
      state:
        branch === 'all'
          ? state
          : sql<string | null>`CASE WHEN ${eq(branches.id, branch.branchId)} THEN ${state} END`,
    })
    .from(branches)
    .where(eq(branches.storyId, storyId))
  const copied = branch === 'all' ? onStory : onStory.filter(({ id }) => id === branch.branchId)
  if (copied.length === 0) return refused(DUPLICATE_REFUSAL.missing)
  if (story.status === 'draft') return refused(DUPLICATE_REFUSAL.draft)
  // pipeline_runs never copies: an unfinished run's writes would land with no marker to recover.
  let unfinished = false
  for (const { id } of copied) {
    unfinished = (await readUnfinishedRuns(id, ctx)).length > 0
    if (unfinished) break
  }
  // Read last, so a marker stored during the reads above counts. The marker as stored, for any
  // story: the in-memory read sees only the open story's.
  if (await readStorySwapPending(ctx.db, storyId)) return refused(DUPLICATE_REFUSAL.swapPending)
  const branchIds = onStory.map(({ id }) => id)
  if (runOnStory(generationStore.getTxState(), storyId, branchIds))
    return refused(DUPLICATE_REFUSAL.runRegistered)
  // The copy takes classifier_status verbatim, so it would inherit the hold.
  if (copied.some(({ state }) => state === 'running')) return refused(DUPLICATE_REFUSAL.branchHeld)
  if (unfinished) return refused(DUPLICATE_REFUSAL.unfinishedRun)
  return { status: 'ok' }
}

type ColumnSet<T extends SQLiteTable> = { readonly [K in keyof T['_']['columns']]?: SQL }

// In SQL, as the copier does: a JS round trip would re-serialize the JSON columns copied verbatim.
function copyRowOp<T extends SQLiteTable>(
  db: DbCtx['db'],
  table: T,
  set: ColumnSet<T>,
  from: SQL,
): SqlOp {
  const given: { readonly [key: string]: SQL | undefined } = set
  const columns = Object.entries(getTableColumns(table)).map(
    ([key, column]) => given[key] ?? sql`${column}`,
  )
  return db
    .insert(table)
    .select(sql`select ${sql.join(columns, sql`, `)} from ${from}`)
    .toSQL()
}

/** Parents before children, since the self-FK is immediate; `created_at, id` within a level. */
function parentsFirst(rows: readonly BranchRow[]): BranchRow[] {
  const onStory = new Set(rows.map(({ id }) => id))
  const placed = new Set<string>()
  const ordered: BranchRow[] = []
  let level = rows.filter(
    ({ parentBranchId }) => parentBranchId == null || !onStory.has(parentBranchId),
  )
  while (level.length > 0) {
    for (const { id } of level) placed.add(id)
    ordered.push(...level)
    level = rows.filter(
      ({ id, parentBranchId }) =>
        !placed.has(id) && parentBranchId != null && placed.has(parentBranchId),
    )
  }
  if (ordered.length < rows.length) throw new Error('duplicateStory: the branches form a cycle')
  return ordered
}

/** data-model.md → Story duplicate. One batch; no lock, no deltas; throws a failed batch. */
export async function duplicateStory(
  input: DuplicateStoryInput,
  ctx: DbCtx,
): Promise<DuplicateStoryResult> {
  const title = input.title.trim()
  if (title === '') return { status: 'rejected', code: DUPLICATE_REFUSAL.empty }
  const { storyId, branch } = input
  const checked = await checkStoryDuplicate(storyId, branch, ctx)
  if (checked.status === 'rejected') return checked

  const [source] = await ctx.db
    .select({ currentBranchId: stories.currentBranchId })
    .from(stories)
    .where(eq(stories.id, storyId))
  const onStory = await readStoryBranches(ctx.db, storyId)
  const copied =
    branch === 'all' ? parentsFirst(onStory) : onStory.filter(({ id }) => id === branch.branchId)
  const copies = copied.map((row) => ({ row, to: generateId('br') }))
  const [first] = copies
  // Gone since the check.
  if (source == null || first == null)
    return { status: 'rejected', code: DUPLICATE_REFUSAL.missing }
  const toOf = new Map(copies.map(({ row, to }) => [row.id, to]))
  const currentBranchId =
    (source.currentBranchId == null ? undefined : toOf.get(source.currentBranchId)) ?? first.to
  const newStoryId = generateId('story')
  const now = Date.now()
  const parentOf = (row: BranchRow): SQL =>
    sql`${row.parentBranchId == null ? null : (toOf.get(row.parentBranchId) ?? null)}`
  const copiedIds = copies.map(({ row }) => row.id)
  // For a tree, the story row alone would let a copy land with no branch once all its sources went.
  const sourceHeld =
    branch === 'all'
      ? sql`select 1 from ${branches} where ${and(
          eq(branches.storyId, storyId),
          inArray(branches.id, copiedIds),
        )}`
      : sql`select 1 from ${branches} where ${and(eq(branches.id, branch.branchId), eq(branches.storyId, storyId))}`
  // The check's refusals as the batch reads them: a run row, or a status, landing after its reads.
  const runUnfinished = sql`select 1 from ${pipelineRuns} where ${and(
    inArray(pipelineRuns.branchId, copiedIds),
    isNull(pipelineRuns.finishedAt),
  )}`
  // A malformed status counts too: the check throws on one, so the batch fails on it as well.
  const classifierRefused = sql`select 1 from ${branches} where ${inArray(branches.id, copiedIds)}
    and case when json_valid(${branches.classifierStatus})
      then json_extract(${branches.classifierStatus}, '$.state') = 'running'
      else ${branches.classifierStatus} is not null end`

  const ops: SqlOp[] = [
    copyRowOp(
      ctx.db,
      stories,
      {
        id: sql`${newStoryId}`,
        // A source gone, or one the check would now refuse, yields a NULL title, failing the batch.
        // `stories` here is the joined source row.
        title: sql`(select ${title} where exists (${sourceHeld})
          and ${stories.status} <> 'draft' and ${storedSwapTarget} is null
          and not exists (${runUnfinished}) and not exists (${classifierRefused}))`,
        status: sql`'active'`,
        favorite: sql`0`,
        lastOpenedAt: sql`null`,
        createdAt: sql`${now}`,
        updatedAt: sql`${now}`,
        currentBranchId: sql`null`,
      },
      sql`(select 1) left join ${stories} on ${eq(stories.id, storyId)}`,
    ),
    ...copies.map(({ row, to }) =>
      copyRowOp(
        ctx.db,
        branches,
        {
          id: sql`${to}`,
          storyId: sql`${newStoryId}`,
          ...(branch === 'all'
            ? { parentBranchId: parentOf(row) }
            : { parentBranchId: sql`null`, forkEntryId: sql`null` }),
        },
        sql`${branches} where ${eq(branches.id, row.id)}`,
      ),
    ),
    // The intended copy if it landed, else the walk's first that did: a lost parent fails the
    // batch, so that is the landed root first on `created_at, id`.
    ctx.db
      .update(stories)
      .set({
        currentBranchId: sql`(select ${branches.id} from ${branches} where ${eq(branches.storyId, newStoryId)}
          order by ${branches.id} = ${currentBranchId} desc, ${branches.parentBranchId} is not null,
          ${branches.createdAt}, ${branches.id} limit 1)`,
      })
      .where(eq(stories.id, newStoryId))
      .toSQL(),
  ]
  for (const { row, to } of copies)
    ops.push(...(await branchCopyOps(ctx.db, { from: row.id, to, mode: 'duplicate' })))
  // Checked again: a swap's marker, a run row or a hold can land during the copier's reads.
  const rechecked = await checkStoryDuplicate(storyId, branch, ctx)
  if (rechecked.status === 'rejected') return rechecked

  // No await from here to the post: a swap or a run admitted during the reads above refuses.
  if (isStorySwapPending(storyId))
    return { status: 'rejected', code: DUPLICATE_REFUSAL.swapPending }
  if (
    runOnStory(
      generationStore.getTxState(),
      storyId,
      onStory.map(({ id }) => id),
    )
  )
    return { status: 'rejected', code: DUPLICATE_REFUSAL.runRegistered }
  const started = Date.now()
  await ctx.runInTransaction(ops)
  logger.debug('action_layer.story_duplicated', {
    storyId,
    newStoryId,
    branches: copies.length,
    ops: ops.length,
    durationMs: Date.now() - started,
  })
  await rehydrateStories(ctx.db)
  return { status: 'duplicated', storyId: newStoryId }
}
