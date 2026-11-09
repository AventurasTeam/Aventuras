import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { USER_EDITED_SINCE_PROSE, type GuardRow, type RowGuard } from '@/lib/actions/types'
import { deltas, readEntryPosition, threads, type Thread } from '@/lib/db'

import { restatedText, sentText } from './fields'
import {
  DELETE_PATH,
  writeToolSchema,
  type LostField,
  type PlannedAction,
  type ProtectionReason,
  type ReportRow,
  type WriteContext,
  type WritePlan,
  type WriteTool,
  type WriteToolSchema,
} from './tool'
import { CLOSE_REASON } from './verdict'

export const THREAD_SHAPE = {
  id: z.string().describe('The thread, by its id as shown (th1, th2…).'),
  description: z
    .string()
    .optional()
    .describe(
      "The thread's description brought up to date, rewritten whole. Leave it out to keep the stored one.",
    ),
  status: z
    .enum(['resolved', 'failed'])
    .optional()
    .describe(
      'resolved when the chapter settles the thread; failed when it makes it impossible or leaves it plainly abandoned. Leave it out otherwise.',
    ),
}

export const MERGE_SHAPE = {
  keep: z.string().describe('The thread to keep, by its id as shown (th1, th2…).'),
  absorb: z
    .array(z.string())
    .describe('The threads that duplicate it, by id: each is folded into keep and deleted.'),
  title: z
    .string()
    .optional()
    .describe("keep's title, rewritten whole. Leave it out to keep its title."),
  description: z
    .string()
    .optional()
    .describe(
      "keep's description, rewritten whole to hold what the absorbed threads added. Leave it out to keep its description.",
    ),
}

type ThreadArgs = z.output<WriteToolSchema<typeof THREAD_SHAPE>>
type MergeArgs = z.output<WriteToolSchema<typeof MERGE_SHAPE>>
type ThreadUpdate = Partial<Pick<ThreadArgs, 'description' | 'status'>>
type ThreadText = Partial<Pick<MergeArgs, 'title' | 'description'>>

const NOTHING_SENT = 'nothing to write: send a description, a status or both'

const MERGE_REFUSAL = {
  emptyAbsorb: 'absorb is empty: name the threads to fold into keep',
  keepAbsorbed: 'keep is also in absorb: keep one thread and absorb the others',
  repeated: 'absorb names a thread twice: name each thread once',
  activeIntoInactive:
    'an active thread can be absorbed only into another active one, or the narrator would lose it: keep an active one, then settle it with update_thread if the chapter resolved or failed it',
  closeWrote:
    'this close already wrote a thread in absorb, and absorbing it would block undoing the close: keep that thread instead',
  closeWroteNoKeep:
    'this close already wrote among these threads and no choice of keep can land, so they cannot be merged in this close: leave them apart',
} as const

async function readThreads(
  ctx: WriteContext,
  ids: readonly string[],
): Promise<ReadonlyMap<string, Thread>> {
  const rows = await ctx.db
    .select()
    .from(threads)
    .where(and(eq(threads.branchId, ctx.branchId), inArray(threads.id, [...new Set(ids)])))
  return new Map(rows.map((row) => [row.id, row]))
}

// A gone row keeps the name the model was shown it by.
function threadRows(
  ctx: WriteContext,
  ids: readonly string[],
  stored: ReadonlyMap<string, Thread>,
): ReportRow[] {
  return [...new Set(ids)].map((id) => ({
    table: 'threads',
    id,
    name: stored.get(id)?.title ?? ctx.ids.nameOfId(id) ?? '',
  }))
}

const protectedField = (field: string, row: string, reason: ProtectionReason): LostField => ({
  field,
  row,
  kind: 'protected',
  reason,
})

/**
 * A status change can't precede its thread: a cited turn before the opening stores the opening
 * (classifier.md → Threads), and an opening off the branch keeps the cited turn. A thread with no
 * opening stores no ref at all (setThreadStatus).
 */
async function closingRef(ctx: WriteContext, thread: Thread): Promise<string> {
  if (thread.triggeredAtEntryId === null) return ctx.proseEntryId
  const [opened, cited] = await Promise.all([
    readEntryPosition(ctx.branchId, thread.triggeredAtEntryId, ctx.db),
    readEntryPosition(ctx.branchId, ctx.proseEntryId, ctx.db),
  ])
  return opened !== null && cited !== null && cited < opened
    ? thread.triggeredAtEntryId
    : ctx.proseEntryId
}

async function planUpdateThread(args: ThreadArgs, ctx: WriteContext): Promise<WritePlan> {
  const { id, status } = args
  const description = sentText(args.description, 'description')
  const proposed: ThreadUpdate = {
    ...(description === undefined ? {} : { description: description.bounded }),
    ...(status === undefined ? {} : { status }),
  }
  const stored = await readThreads(ctx, [id])
  const rows = threadRows(ctx, [id], stored)
  const thread = stored.get(id)
  if (thread === undefined)
    return { kind: 'refused', reason: CLOSE_REASON.rowGone, rows, values: proposed }
  if (Object.keys(proposed).length === 0) return { kind: 'refused', reason: NOTHING_SENT, rows }

  // Ahead of the guard: a value the thread holds is ok with nothing written, never skipped.
  const wanted: ThreadUpdate = {
    ...(description === undefined || restatedText(thread.description, description)
      ? {}
      : { description: description.bounded }),
    ...(status === undefined || status === thread.status ? {} : { status }),
  }
  if (wanted.description === undefined && wanted.status === undefined)
    return { kind: 'write', actions: [], lost: [], rows, values: {} }

  // User precedence rides on each action's proseEntryId; only a later turn's write is read here.
  const verdicts = (await ctx.guard([{ table: 'threads', id }])).row('threads', id)
  const actions: PlannedAction[] = []
  const lost: LostField[] = []
  if (wanted.description !== undefined) {
    if (verdicts.laterTurnWrote('description'))
      lost.push(protectedField('description', id, CLOSE_REASON.laterTurn))
    else
      actions.push({
        action: {
          kind: 'updateThread',
          source: 'chapter_close',
          payload: {
            branchId: ctx.branchId,
            id,
            patch: { description: wanted.description },
            proseEntryId: ctx.proseEntryId,
          },
        },
        fields: ['description'],
        row: id,
      })
  }
  if (wanted.status !== undefined) {
    if (verdicts.laterTurnWrote('status'))
      lost.push(protectedField('status', id, CLOSE_REASON.laterTurn))
    else
      actions.push({
        action: {
          kind: 'setThreadStatus',
          source: 'chapter_close',
          // updateThread keeps a pass's old ref on a machine status change; this sets the new one.
          payload: {
            branchId: ctx.branchId,
            id,
            status: wanted.status,
            proseEntryId: ctx.proseEntryId,
            resolvedAtEntryId: await closingRef(ctx, thread),
          },
        },
        fields: ['status'],
        row: id,
      })
  }
  return { kind: 'write', actions, lost, rows, values: wanted }
}

// Keep's status stands, so an active thread absorbed into a non-active one would leave the prompt.
const dropsActive = (kept: Thread, absorbed: readonly Thread[]): boolean =>
  kept.status !== 'active' && absorbed.some(({ status }) => status === 'active')

function mergeShapeFault(keep: string, absorb: readonly string[]): string | undefined {
  if (absorb.length === 0) return MERGE_REFUSAL.emptyAbsorb
  if (absorb.includes(keep)) return MERGE_REFUSAL.keepAbsorbed
  if (new Set(absorb).size !== absorb.length) return MERGE_REFUSAL.repeated
  return undefined
}

// generation-pipeline.md → Reverse-replay: redo refuses an update and a delete of one row under one
// action, so absorbing a row this close wrote would refuse CTRL-Z of the close for good.
async function closeWrote(ctx: WriteContext, ids: readonly string[]): Promise<ReadonlySet<string>> {
  const hits = await ctx.db
    .selectDistinct({ id: deltas.targetId })
    .from(deltas)
    .where(
      and(
        eq(deltas.branchId, ctx.branchId),
        eq(deltas.actionId, ctx.actionId),
        eq(deltas.targetTable, 'threads'),
        inArray(deltas.targetId, [...ids]),
      ),
    )
  return new Set(hits.map(({ id }) => id))
}

// C11: a later turn's write on any row skips the merge whole, then the user's edit of an absorbed
// row or of a field the merge writes on keep; keep's other fields lose nothing to a merge.
function mergeProtection(
  guard: RowGuard,
  keep: string,
  absorb: readonly string[],
  fields: readonly string[],
): ProtectionReason | undefined {
  const rowOf = (id: string) => guard.row('threads', id)
  if ([keep, ...absorb].some((id) => rowOf(id).laterTurnTouched())) return CLOSE_REASON.laterTurn
  if (
    absorb.some((id) => rowOf(id).userTouched()) ||
    fields.some((field) => rowOf(keep).userWrote(field))
  )
    return USER_EDITED_SINCE_PROSE
  return undefined
}

async function planMergeThreads(args: MergeArgs, ctx: WriteContext): Promise<WritePlan> {
  const { keep, absorb } = args
  const title = sentText(args.title, 'title')
  const description = sentText(args.description, 'description')
  const proposed: ThreadText = {
    ...(title === undefined ? {} : { title: title.bounded }),
    ...(description === undefined ? {} : { description: description.bounded }),
  }
  const named = [keep, ...absorb]
  const fault = mergeShapeFault(keep, absorb)
  if (fault !== undefined)
    return {
      kind: 'refused',
      reason: fault,
      rows: threadRows(ctx, named, new Map()),
      values: proposed,
    }

  const stored = await readThreads(ctx, named)
  const rows = threadRows(ctx, named, stored)
  const kept = stored.get(keep)
  const absorbed = absorb.flatMap((id) => stored.get(id) ?? [])
  if (kept === undefined || absorbed.length < absorb.length)
    return { kind: 'refused', reason: CLOSE_REASON.rowGone, rows, values: proposed }

  const wanted: ThreadText = {
    ...(title === undefined || restatedText(kept.title, title) ? {} : { title: title.bounded }),
    ...(description === undefined || restatedText(kept.description, description)
      ? {}
      : { description: description.bounded }),
  }
  // Keep may be a row this close wrote. A second written row, or a written one that can't be kept
  // either, leaves no merge that can land, so this answers before the advice to swap keep.
  const written = await closeWrote(ctx, named)
  const writtenAbsorbed = absorbed.find(({ id }) => written.has(id))
  const swapped = absorbed.filter((row) => row !== writtenAbsorbed)
  if (
    written.size > 1 ||
    (written.has(kept.id) && dropsActive(kept, absorbed)) ||
    (writtenAbsorbed !== undefined && dropsActive(writtenAbsorbed, [kept, ...swapped]))
  )
    return { kind: 'refused', reason: MERGE_REFUSAL.closeWroteNoKeep, rows, values: wanted }
  if (dropsActive(kept, absorbed))
    return { kind: 'refused', reason: MERGE_REFUSAL.activeIntoInactive, rows, values: wanted }
  if (writtenAbsorbed !== undefined)
    return {
      kind: 'refused',
      reason: MERGE_REFUSAL.closeWrote,
      rows,
      values: wanted,
      note: `Send ${writtenAbsorbed.id} as keep.`,
    }
  const fields = Object.keys(wanted)
  const guard = await ctx.guard(named.map((id): GuardRow => ({ table: 'threads', id })))
  const protection = mergeProtection(guard, keep, absorb, fields)
  if (protection !== undefined)
    return {
      kind: 'write',
      actions: [],
      // The deletes are lost too, so a skipped merge with no text reads skipped, not ok.
      lost: [
        ...fields.map((field) => protectedField(field, keep, protection)),
        ...absorb.map((id) => protectedField(DELETE_PATH, id, protection)),
      ],
      rows,
      values: wanted,
    }

  const actions: PlannedAction[] = []
  if (fields.length > 0)
    actions.push({
      action: {
        kind: 'updateThread',
        source: 'chapter_close',
        payload: {
          branchId: ctx.branchId,
          id: keep,
          patch: wanted,
          proseEntryId: ctx.proseEntryId,
        },
      },
      fields,
      row: keep,
    })
  for (const id of absorb)
    actions.push({
      action: {
        kind: 'deleteThread',
        source: 'chapter_close',
        payload: { branchId: ctx.branchId, id },
      },
      fields: [DELETE_PATH],
      row: id,
    })
  return {
    kind: 'write',
    actions,
    lost: [],
    rows,
    values: wanted,
    survivor: { table: 'threads', id: keep },
  }
}

/** chapter-close.md → 3f: a thread's description brought up to date, and its status once settled. */
export const updateThreadTool: WriteTool<typeof THREAD_SHAPE> = {
  kind: 'write',
  name: 'update_thread',
  description:
    'Bring an open thread up to date: its description, rewritten whole, and its status when the chapter resolves it or fails it. Send only what the cited turns show.',
  schema: writeToolSchema(THREAD_SHAPE),
  ids: { id: { shape: 'single', prefixes: ['thr_'] } },
  plan: planUpdateThread,
}

/** chapter-close.md → 3f: duplicates merged as an update of keep and a delete of each absorbed row. */
export const mergeThreadsTool: WriteTool<typeof MERGE_SHAPE> = {
  kind: 'write',
  name: 'merge_threads',
  description:
    "Merge threads that track the same thing: keep one, and absorb the others, which are deleted. Keep an active thread when any is active: an active thread can be absorbed only into another active one, and keep's status stands. Send a title or a description only to rewrite keep's, covering what the absorbed threads held. Merge all of one thread's duplicates in one call.",
  schema: writeToolSchema(MERGE_SHAPE),
  ids: {
    keep: { shape: 'single', prefixes: ['thr_'] },
    absorb: { shape: 'array', prefixes: ['thr_'] },
  },
  plan: planMergeThreads,
}
