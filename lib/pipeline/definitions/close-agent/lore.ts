import { eq } from 'drizzle-orm'

import type { PromptHalves } from '@/lib/ai'
import { lore, type StoryMode } from '@/lib/db'
import { compareId } from '@/lib/list-modules'
import { TEMPLATE_IDS } from '@/lib/prompts'

import { createLoreTool, LORE_BODY_LIMIT, LORE_CREATE_CAP, updateLoreTool } from './lore-tools'
import { readRowTool, refsIn } from './read-tools'
import type { CloseTaskDef, TaskPromptContext, TaskStart } from './task'
import type { ReadFields } from './tool'
import { hasTurns, readTaskTurns, renderClosePrompt, storyModeOf, type CloseTurns } from './turns'

/** C11: a lore row's fields, which read_row returns; the start shows only titles. */
export const LORE_READ_FIELDS: ReadFields = { lore: ['title', 'body', 'category', 'keywords'] }

export type LoreShow = {
  mode: StoryMode
  closeTurns: CloseTurns
  /** readTaskTurns' stored count of the turns, which primes the system half's count. */
  proseTokens: number
  /** Every lore row on the branch: `id` is its handle. */
  lore: { id: string; title: string }[]
  limits: { creates: number; left: number; bodyChars: number }
}

// memory/chapter-close.md → Run order: the lore titles; starts whenever the part has turns, so a
// story with no lore can still get its first row.
async function startLore(ctx: TaskPromptContext): Promise<TaskStart<LoreShow> | null> {
  const { closeTurns, proseTokens } = await readTaskTurns(ctx)
  if (!hasTurns(closeTurns)) return null
  const rows = await ctx.db
    .select({ id: lore.id, title: lore.title })
    .from(lore)
    .where(eq(lore.branchId, ctx.branchId))
  // Code units, never localeCompare: host locale would make the prompt's row order device-dependent.
  rows.sort((a, b) => compareId(a.title, b.title) || compareId(a.id, b.id))
  // Every row's handle first, so one a title names keeps the number of its place in the list.
  const shown = rows.map((row) => ({ row, id: ctx.ids.show(row.id, row.title) }))
  await refsIn(
    ctx,
    rows.map((row) => row.title),
  )
  return {
    show: {
      mode: await storyModeOf(ctx),
      closeTurns,
      proseTokens,
      lore: shown.map(({ row, id }) => ({ id, title: ctx.ids.withHandles(row.title) })),
      limits: {
        creates: LORE_CREATE_CAP,
        left: Math.max(0, LORE_CREATE_CAP - ctx.landedCalls(createLoreTool)),
        bodyChars: LORE_BODY_LIMIT,
      },
    },
    // C11: titles alone are not every field update_lore writes, so a row takes a read_row first.
    seeds: [],
  }
}

function renderLore(
  { show }: TaskStart<LoreShow>,
  ctx: TaskPromptContext & { writesSoFar: string },
): PromptHalves {
  return renderClosePrompt(
    TEMPLATE_IDS.closeLore,
    show.closeTurns,
    {
      mode: show.mode,
      closeLore: show.lore,
      closeLoreLimits: show.limits,
      closeWritesSoFar: ctx.writesSoFar,
    },
    show.proseTokens,
  )
}

/** memory/chapter-close.md → Run order: Lore, 3a, per part. */
export const loreTask: CloseTaskDef<LoreShow> & { task: 'lore' } = {
  task: 'lore',
  tools: [readRowTool, createLoreTool, updateLoreTool],
  readFields: LORE_READ_FIELDS,
  start: startLore,
  render: renderLore,
}
