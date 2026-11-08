import type { GuardRow } from '@/lib/actions/types'
import type { PromptHalves, ResolveModelConfig } from '@/lib/ai'
import type { CloseTask } from '@/lib/db'

import type { DispatchContext } from './dispatch'
import type { CloseTool, ReadFields } from './tool'

/** chapter-close.md → Run order: what a task starts from. */
export type TaskStart<Show = unknown> = {
  /** What the render shows; the task's own shape. */
  show: Show
  /** Rows whose writable fields the start showed: they count as read (C11). */
  seeds: readonly GuardRow[]
}

/** What the agent phase gives each task; runCloseTask adds the task's own read set. */
export type TaskRunContext = Omit<DispatchContext, 'readSet'> & {
  readonly config: ResolveModelConfig
}

/** A task's start and render make no tool call, so they get no ledger writer. */
export type TaskPromptContext = Omit<TaskRunContext, 'ledger'>

/** A close task: its tools, the fields read_row returns for it, a start read and a render. */
export type CloseTaskDef<Show = unknown> = {
  task: CloseTask
  tools: readonly CloseTool[]
  readFields: ReadFields
  // Methods: their parameters check bivariantly, so a def of any Show fits CloseTaskDef.
  /** Null when there is nothing to show: the task makes no call. */
  start(ctx: TaskPromptContext): Promise<TaskStart<Show> | null>
  render(start: TaskStart<Show>, ctx: TaskPromptContext & { writesSoFar: string }): PromptHalves
}
