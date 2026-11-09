import { and, asc, eq, inArray } from 'drizzle-orm'

import type { PromptHalves } from '@/lib/ai'
import { threads, type StoryMode } from '@/lib/db'
import { renderTemplate, TEMPLATE_IDS } from '@/lib/prompts'

import { readRowTool } from './read-tools'
import type { CloseTaskDef, TaskPromptContext, TaskStart } from './task'
import { mergeThreadsTool, updateThreadTool } from './thread-tools'
import type { ReadFields } from './tool'
import { blankTurns, primeCloseSystemCount, readTaskTurns, storyModeOf } from './turns'
import {
  isOpen,
  OPEN_THREAD_STATUSES,
  type CloseTurn,
  type OpenThreadStatus,
} from '../chapter-context'

/** C11: the fields Threads' start shows, so read_row returns the same and its rows count as read. */
export const THREADS_READ_FIELDS: ReadFields = { thread: ['title', 'description', 'status'] }

export type ThreadsShow = {
  mode: StoryMode
  closeTurns: CloseTurn[]
  /** readTaskTurns' stored count of the turns, which primes the system half's count. */
  proseTokens: number
  threads: { id: string; title: string; description: string; status: OpenThreadStatus }[]
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
    .where(
      and(eq(threads.branchId, ctx.branchId), inArray(threads.status, [...OPEN_THREAD_STATUSES])),
    )
    .orderBy(asc(threads.createdAt), asc(threads.id))
  const open = rows.filter(isOpen)
  if (open.length === 0) return null
  const { closeTurns, proseTokens } = await readTaskTurns(ctx)
  // A task with nothing to start from makes no call; render needs a turn to show.
  if (closeTurns.length === 0) return null
  return {
    show: {
      mode: await storyModeOf(ctx),
      closeTurns,
      proseTokens,
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
  const render = (closeTurns: readonly CloseTurn[]): PromptHalves =>
    renderTemplate(TEMPLATE_IDS.closeThreads, {
      mode: show.mode,
      closeTurns,
      closeThreads: show.threads,
      closeWritesSoFar: ctx.writesSoFar,
    })
  const halves = render(show.closeTurns)
  primeCloseSystemCount(halves.system, render(blankTurns(show.closeTurns)).system, show.proseTokens)
  return halves
}

/** memory/chapter-close.md → Run order: Threads, 3f's Threads bullet, per part. */
export const threadsTask: CloseTaskDef<ThreadsShow> & { task: 'threads' } = {
  task: 'threads',
  tools: [readRowTool, updateThreadTool, mergeThreadsTool],
  readFields: THREADS_READ_FIELDS,
  start: startThreads,
  render: renderThreads,
}
