import { and, eq, inArray } from 'drizzle-orm'

import type { PromptHalves } from '@/lib/ai'
import { chunked, entities, type Entity, type StoryMode } from '@/lib/db'
import { compareId } from '@/lib/list-modules'
import { TEMPLATE_IDS } from '@/lib/prompts'
import { oneLine } from '@/lib/text'
import { characterFactionId, flagStillHolds } from '@/lib/world'

import type { CloseIds } from './ids'
import { charactersInSceneAfter } from './later-scene'
import { flagDuplicateTool, retireEntityTool } from './lifecycle-tools'
import { namedInProse } from './name-match'
import { readRowTool, refsIn, searchWorldTool } from './read-tools'
import type { CloseTaskDef, TaskPromptContext, TaskStart } from './task'
import type { ReadFields } from './tool'
import { hasTurns, readTaskTurns, renderClosePrompt, storyModeOf, type CloseTurns } from './turns'

const LIFECYCLE_PATHS = [
  'status',
  'retiredReason',
  'description',
  'keywords',
  'nameCollisionFlag',
  'nameCollisionPartnerId',
  'nameCollisionReason',
] as const

/**
 * C11: what read_row returns on any entity, a place included since flag_duplicate may name one.
 * The start shows the fields retire_entity and flag_duplicate write, so its rows count as read.
 */
export const LIFECYCLE_READ_FIELDS: ReadFields = {
  character: LIFECYCLE_PATHS,
  location: LIFECYCLE_PATHS,
  item: LIFECYCLE_PATHS,
  faction: LIFECYCLE_PATHS,
}

type LifecycleKind = 'character' | 'item' | 'faction'
type LifecycleEntity = Entity & { kind: LifecycleKind }

/** A starting row as the template shows it: `id` is its handle, a missing text ''. */
export type LifecycleRow = {
  id: string
  kind: LifecycleKind
  name: string
  status: string
  retiredReason: string
  /** Its flag: the partner's handle, name and the reason, marked dormant when it no longer holds; '' if none. */
  collision: string
}

export type LifecycleShow = {
  mode: StoryMode
  closeTurns: CloseTurns
  /** readTaskTurns' stored count of the turns, which primes the system half's count. */
  proseTokens: number
  rows: LifecycleRow[]
}

const KIND_ORDER: readonly LifecycleKind[] = ['character', 'item', 'faction']
const GONE_PARTNER = 'a row that no longer exists'

// Only the user retires a place (chapter-close.md → Phase 4), so the start never lists one.
const isLifecycleRow = (row: Entity): row is LifecycleEntity => row.kind !== 'location'
// Scene data holds characters and items, never factions (data-model.md → Entry metadata shape).
const sceneTagged = (row: LifecycleEntity): boolean => row.kind !== 'faction'
// A hand-edited row may hold anything in a JSON column; only strings are ids.
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
// Code units, never localeCompare: host locale would make the prompt's row order device-dependent.
const byKindThenName = (a: LifecycleEntity, b: LifecycleEntity): number =>
  KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
  compareId(a.name, b.name) ||
  compareId(a.id, b.id)

async function partnersOf(
  ctx: TaskPromptContext,
  rows: readonly Entity[],
): Promise<ReadonlyMap<string, Entity>> {
  const ids = [
    ...new Set(
      rows.flatMap((row) =>
        row.nameCollisionFlag === 1 && row.nameCollisionPartnerId !== null
          ? [row.nameCollisionPartnerId]
          : [],
      ),
    ),
  ]
  const found = new Map<string, Entity>()
  for (const chunk of chunked(ids)) {
    const partners = await ctx.db
      .select()
      .from(entities)
      .where(and(eq(entities.branchId, ctx.branchId), inArray(entities.id, chunk)))
    for (const partner of partners) found.set(partner.id, partner)
  }
  return found
}

/** world.md → Surfacing: the row's flag as read_row reads it, its partner by id and name; a dormant flag counts as none. */
function collisionOf(row: Entity, partners: ReadonlyMap<string, Entity>, ids: CloseIds): string {
  const partnerId = row.nameCollisionFlag === 1 ? row.nameCollisionPartnerId : null
  if (partnerId === null) return ''
  const partner = partners.get(partnerId)
  const who =
    partner === undefined
      ? GONE_PARTNER
      : `${ids.show(partner.id, partner.name)} ${JSON.stringify(oneLine(ids.withHandles(partner.name)))}`
  const reason = row.nameCollisionReason ?? ''
  return flagStillHolds(row, partner) ? `${who} (${reason})` : `${who} (${reason}, dormant)`
}

// memory/chapter-close.md → Run order: the part's active characters and items in scene, the active
// rows its prose names and those characters' factions, less a character a later reply shows.
async function startLifecycle(ctx: TaskPromptContext): Promise<TaskStart<LifecycleShow> | null> {
  const { entries, closeTurns, proseTokens } = await readTaskTurns(ctx)
  if (!hasTurns(closeTurns)) return null
  const sceneIds = new Set(entries.flatMap((entry) => strings(entry.metadata?.sceneEntities)))
  const prose = closeTurns.map((turn) => turn.content).join('\n\n')
  const active = (
    await ctx.db
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.branchId, ctx.branchId),
          eq(entities.status, 'active'),
          inArray(entities.kind, [...KIND_ORDER]),
        ),
      )
  ).filter(isLifecycleRow)
  const touched = new Set(
    active
      .filter((row) => (sceneTagged(row) && sceneIds.has(row.id)) || namedInProse(prose, row))
      .map(({ id }) => id),
  )
  const later = await charactersInSceneAfter(ctx, ctx.endEntryId)
  // Membership before the subtraction: a faction whose member a later reply shows is still in play.
  const members = new Set(
    active
      .filter((row) => touched.has(row.id))
      .flatMap((row) => {
        const factionId = characterFactionId(row)
        return factionId === null ? [] : [factionId]
      }),
  )
  const held = active
    .filter((row) => touched.has(row.id) || (row.kind === 'faction' && members.has(row.id)))
    .filter((row) => !(row.kind === 'character' && later.has(row.id)))
    .sort(byKindThenName)
  if (held.length === 0) return null
  // Shown rows take their handles in the order shown, before a partner or an id in their text.
  for (const row of held) ctx.ids.show(row.id, row.name)
  const partners = await partnersOf(ctx, held)
  await refsIn(ctx, [
    ...held.map((row) => [row.name, row.retiredReason]),
    ...[...partners.values()].map((partner) => partner.name),
  ])
  const handled = (value: string): string => ctx.ids.withHandles(value)
  return {
    show: {
      mode: await storyModeOf(ctx),
      closeTurns,
      proseTokens,
      rows: held.map((row) => ({
        id: ctx.ids.show(row.id, row.name),
        kind: row.kind,
        name: handled(row.name),
        status: row.status,
        retiredReason: handled(row.retiredReason ?? ''),
        collision: collisionOf(row, partners, ctx.ids),
      })),
    },
    seeds: held.map(({ id }) => ({ table: 'entities', id })),
  }
}

function renderLifecycle(
  { show }: TaskStart<LifecycleShow>,
  ctx: TaskPromptContext & { writesSoFar: string },
): PromptHalves {
  return renderClosePrompt(
    TEMPLATE_IDS.closeLifecycle,
    show.closeTurns,
    { mode: show.mode, closeLifecycleRows: show.rows, closeWritesSoFar: ctx.writesSoFar },
    show.proseTokens,
  )
}

/** memory/chapter-close.md → Run order: Lifecycle, Phase 4 and 3f's collision bullet, per part. */
export const lifecycleTask: CloseTaskDef<LifecycleShow> & { task: 'lifecycle' } = {
  task: 'lifecycle',
  tools: [searchWorldTool, readRowTool, retireEntityTool, flagDuplicateTool],
  readFields: LIFECYCLE_READ_FIELDS,
  start: startLifecycle,
  render: renderLifecycle,
}
