import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { USER_EDITED_SINCE_PROSE, type GuardRow, type RowGuard } from '@/lib/actions/types'
import { deltas, readEntryPosition, threads, type InjectionMode, type Thread } from '@/lib/db'

import { restatedText, sentText } from './fields'
import { turnHandleIn, turnInTextReason } from './text-checks'
import {
  DELETE_PATH,
  protectedField,
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
  modeIntoOther:
    "a thread whose injection mode is always or disabled can be absorbed only into one with the same mode, or the user's setting would be lost: keep that thread instead, or leave the threads apart",
  closeWrote:
    'this close already wrote a thread in absorb, and absorbing it would block undoing the close: keep that thread instead',
  noKeep:
    "no choice of keep can land without dropping an active thread or a user's injection mode: leave them apart",
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

  // Precedence before the turn-handle check, so a protected description reads skipped; a user's
  // status edit is kept by the handler, through the action's proseEntryId.
  const verdicts = (await ctx.guard([{ table: 'threads', id }])).row('threads', id)
  const actions: PlannedAction[] = []
  const lost: LostField[] = []
  if (wanted.description !== undefined) {
    const handle = turnHandleIn(wanted.description, ctx.ids)
    if (verdicts.laterTurnWrote('description'))
      lost.push(protectedField('description', id, CLOSE_REASON.laterTurn))
    else if (verdicts.userWrote('description'))
      lost.push(protectedField('description', id, USER_EDITED_SINCE_PROSE))
    else if (handle !== undefined)
      lost.push({
        field: 'description',
        row: id,
        kind: 'refused',
        reason: turnInTextReason(handle),
      })
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

/** What a merge's threads hold that keep must hold too: an active status, and each mode a user set. */
type MergedThreads = { anyActive: boolean; userModes: ReadonlySet<InjectionMode> }

function mergedThreads(rows: readonly Thread[]): MergedThreads {
  return {
    anyActive: rows.some(({ status }) => status === 'active'),
    userModes: new Set(rows.flatMap(({ injectionMode: mode }) => (mode === 'auto' ? [] : [mode]))),
  }
}

// Keep's status and injection mode stand, so a merge refuses what the narrator would silently lose.
function keepFault(kept: Thread, merged: MergedThreads): string | undefined {
  if (kept.status !== 'active' && merged.anyActive) return MERGE_REFUSAL.activeIntoInactive
  if ([...merged.userModes].some((mode) => mode !== kept.injectionMode))
    return MERGE_REFUSAL.modeIntoOther
  return undefined
}

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
  // Each of the threads tried as keep, so a refusal's advice names only a merge that would land.
  const merged = [kept, ...absorbed]
  const held = mergedThreads(merged)
  const fitting = merged.filter((row) => keepFault(row, held) === undefined)
  // A row this close wrote can be kept, never absorbed.
  const written = await closeWrote(ctx, named)
  const landing = fitting.filter(
    (row) => written.size === 0 || (written.size === 1 && written.has(row.id)),
  )
  if (landing.length === 0) {
    const reason = fitting.length === 0 ? MERGE_REFUSAL.noKeep : MERGE_REFUSAL.closeWroteNoKeep
    return { kind: 'refused', reason, rows, values: wanted }
  }
  if (!landing.includes(kept))
    return {
      kind: 'refused',
      reason: keepFault(kept, held) ?? MERGE_REFUSAL.closeWrote,
      rows,
      values: wanted,
      note: `Send ${landing.map(({ id }) => id).join(' or ')} as keep.`,
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
  // Refused whole, not dropped: once the merge lands, no tool could resend keep's new title.
  const handle = [wanted.title, wanted.description]
    .map((text) => (text === undefined ? undefined : turnHandleIn(text, ctx.ids)))
    .find((found) => found !== undefined)
  if (handle !== undefined)
    return { kind: 'refused', reason: turnInTextReason(handle), rows, values: wanted }

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
    "Merge threads that track the same thing: keep one, and absorb the others, which are deleted. Keep's status and injection mode stand. Keep an active thread when any is active: an active thread can be absorbed only into another active one. A thread whose injection mode is always or disabled can be absorbed only into one with the same mode. Send a title or a description only to rewrite keep's, covering what the absorbed threads held. Merge all of one thread's duplicates in one call.",
  schema: writeToolSchema(MERGE_SHAPE),
  ids: {
    keep: { shape: 'single', prefixes: ['thr_'] },
    absorb: { shape: 'array', prefixes: ['thr_'] },
  },
  plan: planMergeThreads,
}
