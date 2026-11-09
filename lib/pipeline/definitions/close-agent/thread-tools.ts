import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { threads, type Thread } from '@/lib/db'

import { restatedText, sentText } from './fields'
import {
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

type ThreadArgs = z.output<WriteToolSchema<typeof THREAD_SHAPE>>
type ThreadUpdate = { description?: string; status?: 'resolved' | 'failed' }

const NOTHING_SENT = 'nothing to write: send a description, a status or both'

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
            resolvedAtEntryId: ctx.proseEntryId,
          },
        },
        fields: ['status'],
        row: id,
      })
  }
  return { kind: 'write', actions, lost, rows, values: wanted }
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
