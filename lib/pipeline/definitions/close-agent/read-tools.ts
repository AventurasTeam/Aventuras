import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import type { PrecedenceTable } from '@/lib/actions/types'
import { entities, happenings, lore, threads } from '@/lib/db'
import { ID_PATTERN } from '@/lib/ids'
import { isJsonObject } from '@/lib/json-object'
import { normalizeTerm } from '@/lib/keyword-terms'
import { matchTerms } from '@/lib/retrieval'
import { excerpt, oneLine } from '@/lib/text'

import { withHandlesDeep, type CloseIds } from './ids'
import {
  readToolSchema,
  tableOfId,
  type ReadAnswer,
  type ReadTool,
  type RowKind,
  type ToolContext,
} from './tool'

/** The most matches search_world answers; a longer list is cut and counted in `omitted`. */
export const SEARCH_WORLD_LIMIT = 20

const LINE_DESCRIPTION_CHARS = 100

const READ_ROW_PREFIXES = ['char', 'loc', 'item', 'fact', 'lore', 'thr', 'hap'] as const

/** A row as read_row reads it: its kind, its name or title, its columns by name. */
type ReadRow = { kind: RowKind; name: string; columns: Readonly<Record<string, unknown>> }

// Raw, so a row the cap cuts mints no handle: only a shown row's line swaps its ids.
type Match = {
  id: string
  kind: string
  name: string
  status: string | null
  description: string | null
  byName: boolean
}

// Dispatch resolved and validated the arguments; a miss here is a dispatch bug.
function stringArg(args: Readonly<Record<string, unknown>>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string') throw new TypeError(`close read tool: ${key} is not a string`)
  return value
}

async function readRow(
  ctx: ToolContext,
  table: PrecedenceTable,
  id: string,
): Promise<ReadRow | undefined> {
  switch (table) {
    case 'entities': {
      const [row] = await ctx.db
        .select()
        .from(entities)
        .where(and(eq(entities.branchId, ctx.branchId), eq(entities.id, id)))
        .limit(1)
      return row && { kind: row.kind, name: row.name, columns: row }
    }
    case 'lore': {
      const [row] = await ctx.db
        .select()
        .from(lore)
        .where(and(eq(lore.branchId, ctx.branchId), eq(lore.id, id)))
        .limit(1)
      return row && { kind: 'lore', name: row.title, columns: row }
    }
    case 'threads': {
      const [row] = await ctx.db
        .select()
        .from(threads)
        .where(and(eq(threads.branchId, ctx.branchId), eq(threads.id, id)))
        .limit(1)
      return row && { kind: 'thread', name: row.title, columns: row }
    }
    case 'happenings': {
      const [row] = await ctx.db
        .select()
        .from(happenings)
        .where(and(eq(happenings.branchId, ctx.branchId), eq(happenings.id, id)))
        .limit(1)
      return row && { kind: 'happening', name: row.title, columns: row }
    }
    default:
      return undefined
  }
}

/** A delta path's value on a row (`description`, `state.voice`); null where it holds nothing. */
function valueAt(columns: Readonly<Record<string, unknown>>, path: string): unknown {
  let value: unknown = columns
  for (const key of path.split('.')) {
    if (!isJsonObject(value)) return null
    value = value[key]
  }
  return value ?? null
}

function refIdsIn(value: unknown): string[] {
  if (typeof value === 'string') return ID_PATTERN.test(value) ? [value] : []
  if (Array.isArray(value)) return value.flatMap(refIdsIn)
  if (isJsonObject(value)) return Object.values(value).flatMap(refIdsIn)
  return []
}

/** A row the answer names: its handle, shown with its name so later prose can name it. */
async function showRef(
  ctx: ToolContext,
  id: string,
): Promise<{ handle: string; name: string } | undefined> {
  const table = tableOfId(id)
  const row = table === null ? undefined : await readRow(ctx, table, id)
  return row && { handle: ctx.ids.show(id, row.name), name: row.name }
}

// Ids go to handles before the cut: excerpt can cut where there's no space, inside an id.
function lineOf(
  ids: CloseIds,
  kind: string,
  name: string,
  status: string | null,
  description: string | null,
): string {
  const shown = oneLine(ids.withHandles(name))
  const label = status === null || status === 'active' ? shown : `${shown} (${status})`
  const about = excerpt(
    description === null ? null : ids.withHandles(description),
    LINE_DESCRIPTION_CHARS,
  )
  return about === undefined ? `${kind}: ${label}` : `${kind}: ${label} — ${about}`
}

// A hand-edited row may hold anything in its keywords; only strings are terms.
function keywordTerms(keywords: unknown): string[] {
  return Array.isArray(keywords)
    ? keywords.filter((k): k is string => typeof k === 'string').map(normalizeTerm)
    : []
}

async function searchWorld(
  args: Readonly<Record<string, unknown>>,
  ctx: ToolContext,
): Promise<ReadAnswer> {
  const query = stringArg(args, 'query')
  const needle = normalizeTerm(query)
  if (needle === '')
    return {
      output: { matches: [], note: 'The query is empty: search by a name, an alias or a keyword.' },
      rows: [],
      read: [],
    }
  // Both ways: a term the query holds whole (an alias inside a longer question), or the query
  // inside a term (part of a keyword).
  const hits = (terms: readonly string[]): boolean => {
    const present = terms.filter((term) => term !== '')
    return matchTerms(query, present).length > 0 || present.some((term) => term.includes(needle))
  }

  const found: Match[] = []
  const entityRows = await ctx.db
    .select({
      id: entities.id,
      kind: entities.kind,
      name: entities.name,
      description: entities.description,
      status: entities.status,
      keywords: entities.keywords,
    })
    .from(entities)
    .where(eq(entities.branchId, ctx.branchId))
  for (const row of entityRows) {
    const byName = hits([normalizeTerm(row.name)])
    if (!byName && !hits(keywordTerms(row.keywords))) continue
    found.push({
      id: row.id,
      name: row.name,
      byName,
      kind: row.kind,
      status: row.status,
      description: row.description,
    })
  }
  const happeningRows = await ctx.db
    .select({ id: happenings.id, title: happenings.title, description: happenings.description })
    .from(happenings)
    .where(eq(happenings.branchId, ctx.branchId))
  for (const row of happeningRows) {
    if (!hits([normalizeTerm(row.title)])) continue
    found.push({
      id: row.id,
      name: row.title,
      byName: true,
      kind: 'happening',
      status: null,
      description: row.description,
    })
  }

  found.sort((a, b) => Number(b.byName) - Number(a.byName) || a.name.localeCompare(b.name))
  const matches = found.slice(0, SEARCH_WORLD_LIMIT).map((match) => ({
    id: ctx.ids.show(match.id, match.name),
    line: lineOf(ctx.ids, match.kind, match.name, match.status, match.description),
  }))
  const omitted = found.length - matches.length
  return { output: omitted > 0 ? { matches, omitted } : { matches }, rows: [], read: [] }
}

async function readRowAnswer(
  args: Readonly<Record<string, unknown>>,
  ctx: ToolContext,
): Promise<ReadAnswer> {
  const id = stringArg(args, 'id')
  const table = tableOfId(id)
  if (table === null) throw new TypeError(`read_row: no table holds ${id}`)
  const row = await readRow(ctx, table, id)

  if (row === undefined) {
    const handle = ctx.ids.handleOf(id) ?? ctx.ids.withHandles(id)
    const kept = ctx.survivorOf(table, id)
    const survivor = kept && ((await showRef(ctx, kept.id))?.handle ?? ctx.ids.withHandles(kept.id))
    return {
      output: survivor
        ? {
            id: handle,
            gone: true,
            survivor,
            note: `This row no longer exists: it was merged into ${survivor}. Read ${survivor} instead.`,
          }
        : { id: handle, gone: true, note: 'This row no longer exists.' },
      rows: [{ table, id, name: ctx.ids.nameOfId(id) ?? '' }],
      read: [],
    }
  }

  const handle = ctx.ids.show(id, row.name)
  const rows = [{ table, id, name: row.name }]
  const paths = ctx.readFields[row.kind] ?? []
  if (paths.length === 0)
    return {
      output: {
        id: handle,
        kind: row.kind,
        name: row.name,
        note: `This task can't read ${row.kind} rows.`,
      },
      rows,
      read: [],
    }

  const fields = Object.fromEntries(paths.map((path) => [path, valueAt(row.columns, path)]))
  const refs: Record<string, string> = {}
  for (const refId of new Set(refIdsIn(fields))) {
    const ref = await showRef(ctx, refId)
    if (ref) refs[ref.handle] = ref.name
  }
  const output = {
    id: handle,
    kind: row.kind,
    name: row.name,
    fields,
    ...(Object.keys(refs).length > 0 ? { refs } : {}),
  }
  return { output: withHandlesDeep(output, ctx.ids), rows, read: [{ table, id }] }
}

export const searchWorldTool: ReadTool = {
  kind: 'read',
  name: 'search_world',
  description: `Find rows of the story's world by name, alias or keyword: characters, places, items, factions and happenings. Use it for a row your task's start doesn't show, such as one the prose calls "the capital". Answers up to ${SEARCH_WORLD_LIMIT} matches, each an id and one line. A match isn't read: call read_row before writing to it.`,
  schema: readToolSchema({
    query: z.string().describe('A name, an alias or a keyword, or part of one.'),
  }),
  ids: {},
  read: searchWorld,
}

export const readRowTool: ReadTool = {
  kind: 'read',
  name: 'read_row',
  description:
    "Read one row: the fields this task may write. Write only to a row you've read, unless the task's start showed you those fields. A row that no longer exists is answered as gone, naming the row it was merged into when there is one.",
  schema: readToolSchema({
    id: z.string().describe('The row id, as you were shown it (c1, lo2, th1).'),
  }),
  ids: { id: { shape: 'single', prefixes: READ_ROW_PREFIXES } },
  read: readRowAnswer,
}
