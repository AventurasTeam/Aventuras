import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { chunked, storyEntries, type StoryEntry } from '@/lib/db'
import { promptProse } from '@/lib/piggyback'

import { TURN_PREFIX } from './ids'
import {
  FULL_ID_SHAPE,
  readToolSchema,
  type ReadAnswer,
  type ReadTool,
  type ToolContext,
} from './tool'

/** The most turns one call answers; the rest it names as unread, for another call. */
export const READ_TURNS_MAX = 10

const readTurnsSchema = readToolSchema({
  turns: z.array(z.string()).describe('The turns to read, by handle (t1, t2…).'),
})

type TurnRow = Pick<StoryEntry, 'id' | 'kind' | 'content' | 'position' | 'createdAt'>
type NotRead = { id: string; reason: string }
type ReadTurnsOutput = {
  turns: { id: string; kind: StoryEntry['kind']; prose: string }[]
  unread?: string[]
  notRead?: NotRead[]
}

const REASON = {
  unknown: 'no turn was shown with this handle',
  notTurn: 'not a turn: read_turns takes turn handles (t1, t2…)',
  fullId: 'a full id: give the short handle you were shown (t1, t2…)',
  missing: 'no such turn on this branch',
  system: 'a system note, not a turn of the story',
  pastEnd: 'past the end of this chapter',
} as const

// Never echoed: the answer's swap to handles would mint a handle for a full id it found.
const FULL_ID_LABEL = 'a full id'

async function readRows(ctx: ToolContext, ids: readonly string[]): Promise<Map<string, TurnRow>> {
  const rows = new Map<string, TurnRow>()
  for (const chunk of chunked(ids)) {
    const found = await ctx.db
      .select({
        id: storyEntries.id,
        kind: storyEntries.kind,
        content: storyEntries.content,
        position: storyEntries.position,
        createdAt: storyEntries.createdAt,
      })
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, ctx.branchId), inArray(storyEntries.id, chunk)))
    for (const row of found) rows.set(row.id, row)
  }
  return rows
}

function judge(
  handle: string,
  id: string | undefined,
  rows: ReadonlyMap<string, TurnRow>,
  endPosition: number,
): { row: TurnRow } | { notRead: NotRead } {
  if (id === undefined)
    return {
      notRead: FULL_ID_SHAPE.test(handle)
        ? { id: FULL_ID_LABEL, reason: REASON.fullId }
        : { id: handle, reason: REASON.unknown },
    }
  if (!id.startsWith(TURN_PREFIX)) return { notRead: { id: handle, reason: REASON.notTurn } }
  const row = rows.get(id)
  if (row === undefined) return { notRead: { id: handle, reason: REASON.missing } }
  if (row.kind === 'system') return { notRead: { id: handle, reason: REASON.system } }
  if (row.position > endPosition) return { notRead: { id: handle, reason: REASON.pastEnd } }
  return { row }
}

// From SQLite, not entriesStore: the store holds a window, and a listed row can come from any chapter.
async function readTurns(
  { turns }: z.output<typeof readTurnsSchema>,
  ctx: ToolContext,
): Promise<ReadAnswer> {
  const asked = turns.map((handle) => ({ handle, id: ctx.ids.idOf(handle) }))
  const entryIds = new Set(
    asked.flatMap(({ id }) => (id !== undefined && id.startsWith(TURN_PREFIX) ? [id] : [])),
  )
  const rows = await readRows(ctx, [...entryIds, ctx.endEntryId])
  const end = rows.get(ctx.endEntryId)
  if (end === undefined)
    throw new Error(`read_turns: the chapter's end entry ${ctx.endEntryId} is not on the branch`)

  const notRead: NotRead[] = []
  const readable = new Map<string, { row: TurnRow; handle: string }>()
  for (const { handle, id } of asked) {
    const verdict = judge(handle, id, rows, end.position)
    if ('notRead' in verdict) notRead.push(verdict.notRead)
    else if (!readable.has(verdict.row.id))
      readable.set(verdict.row.id, {
        row: verdict.row,
        handle: ctx.ids.handleOf(verdict.row.id) ?? handle,
      })
  }
  const ordered = [...readable.values()].sort(
    (a, b) => a.row.position - b.row.position || a.row.createdAt - b.row.createdAt,
  )
  const output: ReadTurnsOutput = {
    turns: ordered
      .slice(0, READ_TURNS_MAX)
      .map(({ row, handle }) => ({ id: handle, kind: row.kind, prose: promptProse(row) })),
  }
  const unread = ordered.slice(READ_TURNS_MAX).map(({ handle }) => handle)
  if (unread.length > 0) output.unread = unread
  if (notRead.length > 0) output.notRead = notRead
  return { output, rows: [], read: [] }
}

export const readTurnsTool: ReadTool<typeof readTurnsSchema> = {
  kind: 'read',
  name: 'read_turns',
  description: `Read turns of the story by handle (t1, t2…): each one's prose, in story order. Any turn up to the end of this chapter can be read, an earlier chapter's included; at most ${READ_TURNS_MAX} a call, the rest named as unread for another call. A write still cites only the turns of this chapter.`,
  schema: readTurnsSchema,
  ids: {},
  read: readTurns,
}
