import { and, eq, inArray } from 'drizzle-orm'

import type { PromptHalves } from '@/lib/ai'
import { chunked, entities, type Entity, type StoryMode } from '@/lib/db'
import { isJsonObject } from '@/lib/json-object'
import { normalizeTerm } from '@/lib/keyword-terms'
import { TEMPLATE_IDS } from '@/lib/prompts'
import { matchTerms } from '@/lib/retrieval'
import { CAST_SOFT_CAPS } from '@/lib/wizard'

import { updateCharacterTool, updateFactionTool } from './identity-tools'
import { readRowTool, searchWorldTool } from './read-tools'
import type { CloseTaskDef, TaskPromptContext, TaskStart } from './task'
import type { ReadFields } from './tool'
import { readTaskTurns, renderClosePrompt, storyModeOf } from './turns'
import type { CloseTurn } from '../chapter-context'

/** C11: the fields Identity's start shows, so read_row returns the same and its rows count as read. */
export const IDENTITY_READ_FIELDS: ReadFields = {
  character: ['description', 'state.traits', 'state.drives', 'state.voice'],
  faction: ['description', 'state.standing', 'state.agenda'],
}

/** A starting character as the template shows it: `id` is its handle, a missing text ''. */
export type IdentityCharacter = {
  id: string
  name: string
  status: string
  description: string
  traits: string[]
  drives: string[]
  voice: string
}

/** A starting faction as the template shows it: `id` is its handle, a missing text ''. */
export type IdentityFaction = {
  id: string
  name: string
  status: string
  description: string
  standing: string
  agenda: string[]
}

export type IdentityShow = {
  mode: StoryMode
  closeTurns: CloseTurn[]
  /** readTaskTurns' stored count of the turns, which primes the system half's count. */
  proseTokens: number
  characters: IdentityCharacter[]
  factions: IdentityFaction[]
}

// A hand-edited row may hold anything in a JSON column; only strings are shown.
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const stateOf = (row: Entity): Readonly<Record<string, unknown>> =>
  isJsonObject(row.state) ? row.state : {}
// Code units, never localeCompare: the host locale would make the prompt's row order device-dependent.
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const byNameThenId = (a: Entity, b: Entity): number => cmp(a.name, b.name) || cmp(a.id, b.id)

// Any status: canon names the entities the chapter touches, and a retired one was still there.
async function sceneCharacters(
  ctx: TaskPromptContext,
  sceneIds: readonly string[],
): Promise<Entity[]> {
  const rows: Entity[] = []
  for (const ids of chunked(sceneIds))
    rows.push(
      ...(await ctx.db
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.branchId, ctx.branchId),
            eq(entities.kind, 'character'),
            inArray(entities.id, ids),
          ),
        )),
    )
  return rows.sort(byNameThenId)
}

function namedIn(prose: string, row: Entity): boolean {
  // matchTerms lowercases only the prose, so the terms arrive normalized.
  const terms = [row.name, ...strings(row.keywords)]
    .map(normalizeTerm)
    .filter((term) => term !== '')
  return matchTerms(prose, terms).length > 0
}

// principles.md → Scene presence: scene data holds no factions, so a faction comes by a
// starting character's membership or by its name or a keyword in the turns.
async function touchedFactions(
  ctx: TaskPromptContext,
  characters: readonly Entity[],
  turns: readonly CloseTurn[],
): Promise<Entity[]> {
  const members = new Set(characters.map((row) => text(stateOf(row).faction_id)))
  const prose = turns.map((turn) => turn.content).join('\n\n')
  const rows = await ctx.db
    .select()
    .from(entities)
    .where(and(eq(entities.branchId, ctx.branchId), eq(entities.kind, 'faction')))
  return rows.filter((row) => members.has(row.id) || namedIn(prose, row)).sort(byNameThenId)
}

async function startIdentity(ctx: TaskPromptContext): Promise<TaskStart<IdentityShow> | null> {
  const { entries, closeTurns, proseTokens } = await readTaskTurns(ctx)
  const sceneIds = new Set(entries.flatMap((entry) => strings(entry.metadata?.sceneEntities)))
  const characters = await sceneCharacters(ctx, [...sceneIds])
  const factions = await touchedFactions(ctx, characters, closeTurns)
  if (characters.length === 0 && factions.length === 0) return null
  return {
    show: {
      mode: await storyModeOf(ctx),
      closeTurns,
      proseTokens,
      characters: characters.map((row) => {
        const state = stateOf(row)
        return {
          id: ctx.ids.show(row.id, row.name),
          name: row.name,
          status: row.status,
          description: row.description ?? '',
          traits: strings(state.traits),
          drives: strings(state.drives),
          voice: text(state.voice),
        }
      }),
      factions: factions.map((row) => {
        const state = stateOf(row)
        return {
          id: ctx.ids.show(row.id, row.name),
          name: row.name,
          status: row.status,
          description: row.description ?? '',
          standing: text(state.standing),
          agenda: strings(state.agenda),
        }
      }),
    },
    seeds: [...characters, ...factions].map(({ id }) => ({ table: 'entities', id })),
  }
}

function renderIdentity(
  { show }: TaskStart<IdentityShow>,
  ctx: TaskPromptContext & { writesSoFar: string },
): PromptHalves {
  // An unset closeTurns renders an empty "# The turns".
  if (show.closeTurns.length === 0)
    throw new Error('identity: a close task renders over at least one turn')
  return renderClosePrompt(
    TEMPLATE_IDS.closeIdentity,
    show.closeTurns,
    {
      mode: show.mode,
      closeCharacters: show.characters,
      closeFactions: show.factions,
      closeWritesSoFar: ctx.writesSoFar,
      closeSoftCaps: { ...CAST_SOFT_CAPS },
    },
    show.proseTokens,
  )
}

/** memory/chapter-close.md → Run order: Identity, 3b, per part. */
export const identityTask: CloseTaskDef<IdentityShow> & { task: 'identity' } = {
  task: 'identity',
  tools: [searchWorldTool, readRowTool, updateCharacterTool, updateFactionTool],
  readFields: IDENTITY_READ_FIELDS,
  start: startIdentity,
  render: renderIdentity,
}
