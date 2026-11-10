import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'

import type { PromptHalves } from '@/lib/ai'
import { entities } from '@/lib/db'
import { generateId } from '@/lib/ids'

import {
  entityWriteAction,
  fieldVerdicts,
  restatedFields,
} from '../definitions/close-agent/entity-write'
import { readRowTool } from '../definitions/close-agent/read-tools'
import type { CloseAgentSlots } from '../definitions/close-agent/slots'
import type { CloseTaskDef, TaskPromptContext, TaskStart } from '../definitions/close-agent/task'
import {
  writeToolSchema,
  type LostField,
  type PlannedAction,
  type ReportRow,
  type WriteContext,
  type WritePlan,
  type WriteTool,
} from '../definitions/close-agent/tool'
import { CLOSE_REASON } from '../definitions/close-agent/verdict'

/*
 * A test-only close task, shared by the round-trip suite and `pnpm probe:close`: one write landing
 * a create and an update in one group. Never in a production slot.
 */

const STAND_IN_SHAPE = {
  id: z.string().describe('The character, by the short id it is shown under, such as c1.'),
  description: z.string().describe('Its new description, one sentence.'),
  title: z.string().describe('The title of a new lore entry about this chapter.'),
  body: z.string().describe('The text of that lore entry.'),
}

// Not strict: the args a plan gets carry `turns` and `why` too, which the tool schema checked.
const standInArgs = z.object(STAND_IN_SHAPE)

async function planStandIn(args: Record<string, unknown>, ctx: WriteContext): Promise<WritePlan> {
  const input = standInArgs.parse(args)
  const created: ReportRow = { table: 'lore', id: generateId('lore'), name: input.title }
  const [row] = await ctx.db
    .select()
    .from(entities)
    .where(and(eq(entities.branchId, ctx.branchId), eq(entities.id, input.id)))
  if (row === undefined)
    return {
      kind: 'refused',
      reason: CLOSE_REASON.rowGone,
      rows: [
        { table: 'entities', id: input.id, name: ctx.ids.nameOfId(input.id) ?? input.id },
        created,
      ],
      values: { description: input.description, title: input.title, body: input.body },
    }

  const now = Date.now()
  const create: PlannedAction = {
    action: {
      kind: 'createLore',
      source: 'chapter_close',
      payload: {
        entry: {
          id: created.id,
          branchId: ctx.branchId,
          title: input.title,
          body: input.body,
          injectionMode: 'auto',
          createdAt: now,
          updatedAt: now,
        },
      },
    },
    fields: ['title', 'body'],
    row: 'lore',
  }
  const values: Record<string, unknown> = { title: input.title, body: input.body }
  const wanted: Record<string, unknown> = {}
  const lost: LostField[] = []
  // C11: a value already stored is no write and no field.
  if (restatedFields(row, { description: input.description }).length === 0) {
    values.description = input.description
    const guard = await ctx.guard([{ table: 'entities', id: row.id }])
    for (const verdict of fieldVerdicts(guard.row('entities', row.id), ['description'])) {
      if (verdict.free) wanted[verdict.field] = input.description
      else
        lost.push({ field: verdict.field, reason: verdict.reason, row: row.id, kind: 'protected' })
    }
  }
  const update = Object.keys(wanted).length > 0 ? [entityWriteAction(row, wanted)] : []
  return {
    kind: 'write',
    actions: [create, ...update],
    lost,
    rows: [{ table: 'entities', id: row.id, name: row.name }, created],
    values,
    createdId: created.id,
  }
}

export const standInTool: WriteTool = {
  kind: 'write',
  name: 'stand_in_write',
  description:
    'Gives the character shown a new description and adds one lore entry about this chapter, as one write.',
  schema: writeToolSchema(STAND_IN_SHAPE),
  ids: { id: { shape: 'single', prefixes: ['char_'] } },
  plan: planStandIn,
}

type StandInShow = { handle: string; name: string; description: string }

// One character, so it is always c1 (the dev mock's scripted call names it so).
async function startStandIn(ctx: TaskPromptContext): Promise<TaskStart<StandInShow> | null> {
  const [row] = await ctx.db
    .select({ id: entities.id, name: entities.name, description: entities.description })
    .from(entities)
    .where(
      and(
        eq(entities.branchId, ctx.branchId),
        eq(entities.kind, 'character'),
        eq(entities.status, 'active'),
      ),
    )
    .orderBy(asc(entities.name), asc(entities.id))
    .limit(1)
  if (row === undefined) return null
  return {
    show: {
      handle: ctx.ids.show(row.id, row.name),
      name: row.name,
      description: row.description ?? '',
    },
    seeds: [{ table: 'entities', id: row.id }],
  }
}

const STAND_IN_SYSTEM = [
  'You are testing the task runner of a chapter close. This is an automated system: no one reads your text, and only your tool calls take effect.',
  'Call stand_in_write once: give the character shown a new one-sentence description, and add one lore entry about this chapter. Cite the turns it rests on in `turns`, by their t handles, and give one sentence of `why`.',
  'Then reply with no tool call.',
].join('\n\n')

function renderStandIn(
  { show: shown }: TaskStart<StandInShow>,
  ctx: TaskPromptContext & { writesSoFar: string },
): PromptHalves {
  const turns = ctx.taskEntryIds.flatMap((id) => ctx.ids.handleOf(id) ?? [])
  return {
    system: STAND_IN_SYSTEM,
    user: [
      `Character: [${shown.handle}] ${shown.name}: ${shown.description}`,
      `Turns of this chapter: ${turns.join(', ')}`,
      `Writes so far:\n${ctx.writesSoFar === '' ? '(none)' : ctx.writesSoFar}`,
    ].join('\n\n'),
  }
}

export const standInTask: CloseTaskDef<StandInShow> & { task: 'identity' } = {
  task: 'identity',
  tools: [standInTool, readRowTool],
  readFields: { character: ['description'] },
  start: startStandIn,
  render: renderStandIn,
}

export function standInSlots(): CloseAgentSlots {
  return { before: [], perPart: [{ kind: 'task', def: standInTask }], after: [] }
}
