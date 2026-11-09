import { and, asc, eq, inArray } from 'drizzle-orm'

import type { PromptHalves } from '@/lib/ai'
import { threads, type StoryMode, type ThreadStatus } from '@/lib/db'
import { renderTemplate, TEMPLATE_IDS } from '@/lib/prompts'

import { readRowTool } from './read-tools'
import type { CloseTaskDef, TaskPromptContext, TaskStart } from './task'
import { mergeThreadsTool, updateThreadTool } from './thread-tools'
import type { ReadFields } from './tool'
import { readTaskTurns, storyModeOf } from './turns'
import type { CloseTurn } from '../chapter-context'

/** C11: the fields Threads' start shows, so read_row returns the same and its rows count as read. */
export const THREADS_READ_FIELDS: ReadFields = { thread: ['title', 'description', 'status'] }

type OpenStatus = Extract<ThreadStatus, 'pending' | 'active'>
const OPEN_STATUSES: readonly OpenStatus[] = ['pending', 'active']
const isOpen = (status: ThreadStatus): status is OpenStatus =>
  status === 'pending' || status === 'active'

export type ThreadsShow = {
  mode: StoryMode
  closeTurns: CloseTurn[]
  threads: { id: string; title: string; description: string; status: 'pending' | 'active' }[]
}

// memory/chapter-close.md → Run order: the open threads, the user's included.
async function startThreads(ctx: TaskPromptContext): Promise<TaskStart<ThreadsShow> | null> {
  const rows = await ctx.db
    .select({
      id: threads.id,
      title: threads.title,
      description: threads.description,
      status: threads.status,
    })
    .from(threads)
    .where(and(eq(threads.branchId, ctx.branchId), inArray(threads.status, [...OPEN_STATUSES])))
    .orderBy(asc(threads.createdAt), asc(threads.id))
  const open = rows.flatMap((row) => (isOpen(row.status) ? [{ ...row, status: row.status }] : []))
  if (open.length === 0) return null
  const { closeTurns } = await readTaskTurns(ctx)
  return {
    show: {
      mode: await storyModeOf(ctx),
      closeTurns,
      threads: open.map((row) => ({
        id: ctx.ids.show(row.id, row.title),
        title: row.title,
        description: row.description ?? '',
        status: row.status,
      })),
    },
    seeds: open.map(({ id }) => ({ table: 'threads', id })),
  }
}

function renderThreads(
  { show }: TaskStart<ThreadsShow>,
  ctx: TaskPromptContext & { writesSoFar: string },
): PromptHalves {
  // An unset closeTurns renders an empty "# The turns".
  if (show.closeTurns.length === 0)
    throw new Error('threads: a close task renders over at least one turn')
  return renderTemplate(TEMPLATE_IDS.closeThreads, {
    mode: show.mode,
    closeTurns: show.closeTurns,
    closeThreads: show.threads,
    closeWritesSoFar: ctx.writesSoFar,
  })
}

/** memory/chapter-close.md → Run order: Threads, 3f's Threads bullet, per part. */
export const threadsTask: CloseTaskDef<ThreadsShow> & { task: 'threads' } = {
  task: 'threads',
  tools: [readRowTool, updateThreadTool, mergeThreadsTool],
  readFields: THREADS_READ_FIELDS,
  start: startThreads,
  render: renderThreads,
}
