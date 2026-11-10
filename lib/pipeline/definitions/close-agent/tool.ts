import { z } from 'zod'

import type {
  GuardRow,
  PipelineAction,
  PrecedenceTable,
  RowGuard,
  USER_EDITED_SINCE_PROSE,
} from '@/lib/actions/types'
import type { ToolStepTool } from '@/lib/ai'
import type { CloseReportCall, CloseTask, DbCtx } from '@/lib/db'
import type { SubstitutablePrefix } from '@/lib/ids'

import type { CloseIds } from './ids'
import type { CLOSE_REASON } from './verdict'

export type RowKind =
  | 'character'
  | 'location'
  | 'item'
  | 'faction'
  | 'lore'
  | 'thread'
  | 'happening'
/** Delta paths a task's read_row returns per row kind ('description', 'state.voice'). */
export type ReadFields = Readonly<Partial<Record<RowKind, readonly string[]>>>
type IdKind = SubstitutablePrefix | 'entry' | 'haw'
/** An id kind CloseIds hands a handle for, spelled with or without its underscore. */
export type IdPrefix = IdKind | `${IdKind}_`
/** An argument holding row handles; `prefixes` are the id kinds it takes (`char` or `char_`). */
export type IdArg = { shape: 'single' | 'array'; prefixes: readonly IdPrefix[] }
export type ReportRow = CloseReportCall['rows'][number]

export type ToolContext = {
  readonly db: DbCtx['db']
  readonly branchId: string
  readonly endEntryId: string
  readonly task: CloseTask
  readonly part: number
  readonly ids: CloseIds
  readonly readFields: ReadFields
  /** A landed merge's kept row for a row this close absorbed. */
  readonly survivorOf: (table: string, id: string) => { table: string; id: string } | undefined
  /** The ledger's landed (`ok`) calls of `tool` so far, across tasks and parts. */
  readonly landedCalls: (tool: string) => number
}
export type WriteContext = ToolContext & {
  /** Cited entry ids, resolved. */
  readonly turns: readonly string[]
  /** The latest cited turn by position. */
  readonly proseEntryId: string
  readonly guard: (rows: readonly GuardRow[]) => Promise<RowGuard>
  /** The run's action: a delta under it is this close's own write. */
  readonly actionId: string
}

/** The delta path a delete's PlannedAction names: no column starts with `$`, so never in `values`. */
export const DELETE_PATH = '$deleted'

export type PlannedAction = {
  readonly action: PipelineAction & { readonly source: 'chapter_close' }
  readonly fields: readonly string[]
  /**
   * The row as the model's answer names it; a full id is allowed, the answer swaps it for its
   * handle.
   * - An entity, lore, thread or happening row: its id, shown first with its name
   *   (`ctx.ids.show(id, name)`) if the close hasn't; otherwise its handle is nameless and prose
   *   naming it can't be resolved.
   * - A create's action and its LostFields: the table name, since a minted id has no handle unless
   *   the create lands.
   * - A link row (involvement, awareness): the character it links, as
   *   `${characterId} on ${happeningId}` only when the call spans several happenings. Never the
   *   link row's own id: `hinv_` has no handle, and a character tells the model more than an `aw`.
   * - Else the row's table name.
   */
  readonly row: string
}
/** Why precedence keeps a field (C4's keys): the user's edit after the prose, or a later turn. */
export type ProtectionReason = typeof USER_EDITED_SINCE_PROSE | (typeof CLOSE_REASON)['laterTurn']
export type LostField = {
  readonly field: string
  /** As PlannedAction.row. */
  readonly row: string
} & (
  | { readonly kind: 'protected'; readonly reason: ProtectionReason }
  | { readonly kind: 'refused'; readonly reason: string }
)
export type WritePlan =
  | {
      kind: 'refused'
      /** `row-gone` when a row the call names is missing; dispatch adds its survivor. */
      reason: string
      rows: readonly ReportRow[]
      /** Proposed fields, delta path → raw value, kept as the report's Not applied values. */
      values?: Readonly<Record<string, unknown>>
      /** A rule refusal's advice for the model's answer; never in the ledger. */
      note?: string
    }
  | {
      kind: 'write'
      /** Empty when nothing is left to land: no group is emitted. */
      actions: readonly PlannedAction[]
      lost: readonly LostField[]
      rows: readonly ReportRow[]
      /** Delta path → raw value landed or proposed; absent if restated on every row it names. */
      values: Readonly<Record<string, unknown>>
      /** A create's new row id, answered to the model as its handle. */
      createdId?: string
      /** A merge's kept row. */
      survivor?: { table: string; id: string }
    }

type IdArgFor<V> = unknown extends V
  ? IdArg
  : NonNullable<V> extends readonly string[]
    ? IdArg & { shape: 'array' }
    : NonNullable<V> extends string
      ? IdArg & { shape: 'single' }
      : never
/** A tool's id arguments, keyed by its schema's keys, each shaped as that key's value. */
export type IdArgs<S extends z.ZodObject> = {
  readonly [K in keyof z.output<S> & string]?: IdArgFor<z.output<S>[K]>
}
/** writeToolSchema's result, so every write's args carry `turns` and `why`. */
export type WriteToolSchema<S extends z.ZodRawShape = z.ZodRawShape> = ReturnType<
  typeof writeToolSchema<S>
>
export type WriteTool<S extends z.ZodRawShape = z.ZodRawShape> = {
  kind: 'write'
  name: string
  description: string
  schema: WriteToolSchema<S>
  ids: IdArgs<WriteToolSchema<S>>
  plan(args: z.output<WriteToolSchema<S>>, ctx: WriteContext): Promise<WritePlan>
}
export type ReadAnswer = {
  /** What the model reads, handles only. */
  output: unknown
  rows: readonly ReportRow[]
  /** Rows the answer counts as read: read_row's when it returned fields, search_world's none. */
  read: readonly GuardRow[]
}
export type ReadTool<S extends z.ZodObject = z.ZodObject> = {
  kind: 'read'
  name: string
  description: string
  schema: S
  ids: IdArgs<S>
  read(args: z.output<S>, ctx: ToolContext): Promise<ReadAnswer>
}
export type CloseTool = WriteTool | ReadTool

const TURNS_DESCRIPTION = 'The turns this write rests on, by handle (t1, t2…).'
const WHY_DESCRIPTION =
  'One sentence for the review: what in the cited turns makes this write true.'

/**
 * A write tool's schema: its shape plus `turns` and `why`, strict at the top. The SDK replays the
 * parsed call as the model's own, so no field may change what it wrote (assertReplaySafe).
 */
export function writeToolSchema<S extends z.ZodRawShape>(shape: S) {
  if (Object.hasOwn(shape, 'turns') || Object.hasOwn(shape, 'why'))
    throw new Error("writeToolSchema: turns and why are every write tool's own; leave them out")
  return z.strictObject({
    ...shape,
    turns: z.array(z.string()).describe(TURNS_DESCRIPTION),
    why: z.string().describe(WHY_DESCRIPTION),
  })
}

/** A read tool's schema, strict at the top; the replay contract holds as for a write. */
export function readToolSchema<S extends z.ZodRawShape>(shape: S) {
  return z.strictObject(shape)
}

export function toolStepTools(tools: readonly CloseTool[]): Record<string, ToolStepTool> {
  const out: Record<string, ToolStepTool> = {}
  for (const { name, description, schema } of tools) {
    if (Object.hasOwn(out, name)) throw new Error(`toolStepTools: ${name} is listed twice`)
    out[name] = { description, inputSchema: schema }
  }
  return out
}

const TABLE_BY_PREFIX = new Map<string, PrecedenceTable>([
  ['char_', 'entities'],
  ['loc_', 'entities'],
  ['item_', 'entities'],
  ['fact_', 'entities'],
  ['lore_', 'lore'],
  ['thr_', 'threads'],
  ['hap_', 'happenings'],
  ['haw_', 'happening_awareness'],
])

const KIND_BY_PREFIX = new Map<string, string>([
  ['char_', 'a character'],
  ['loc_', 'a place'],
  ['item_', 'an item'],
  ['fact_', 'a faction'],
  ['lore_', 'a lore row'],
  ['thr_', 'a thread'],
  ['hap_', 'a happening'],
  ['haw_', 'an awareness row'],
  ['entry_', 'a turn'],
  ['chap_', 'a chapter'],
])

// An id the model was never shown as a handle; echoing it back would let withHandles mint one.
export const FULL_ID_SHAPE =
  /[a-z][a-z0-9]*_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/

const prefixOf = (id: string): string => id.slice(0, id.indexOf('_') + 1)
const asPrefix = (prefix: IdPrefix): string => (prefix.endsWith('_') ? prefix : `${prefix}_`)
const kindOf = (prefix: string): string => KIND_BY_PREFIX.get(prefix) ?? 'another kind of row'

export function tableOfId(id: string): PrecedenceTable | null {
  return TABLE_BY_PREFIX.get(prefixOf(id)) ?? null
}

/**
 * Swaps each declared id argument's handles for full ids; a handle never shown, or of a kind the
 * argument doesn't take, refuses the call. `named` holds each resolved row once.
 */
export function resolveIdArgs(
  input: Readonly<Record<string, unknown>>,
  tool: CloseTool,
  ids: CloseIds,
):
  | { ok: true; args: Record<string, unknown>; named: readonly GuardRow[] }
  | { ok: false; reason: string } {
  const args: Record<string, unknown> = { ...input }
  const named = new Map<string, GuardRow>()
  for (const [key, arg] of Object.entries(tool.ids)) {
    if (arg === undefined) continue
    const value = input[key]
    if (value === undefined || value === null) continue
    if ((arg.shape === 'array') !== Array.isArray(value))
      return {
        ok: false,
        reason: `${key} takes ${arg.shape === 'array' ? 'a list of ids' : 'one id'}`,
      }
    const handles: unknown[] = Array.isArray(value) ? value : [value]
    const resolved: string[] = []
    for (const handle of handles) {
      const id = typeof handle === 'string' ? ids.idOf(handle) : undefined
      if (id === undefined && typeof handle === 'string' && FULL_ID_SHAPE.test(handle))
        return { ok: false, reason: `${key} takes a short id as shown (c1, lo2…), not a full id` }
      if (id === undefined)
        return {
          ok: false,
          reason: `${String(handle)} in ${key} is not a known id; use an id this task showed you`,
        }
      const prefix = prefixOf(id)
      if (!arg.prefixes.some((p) => asPrefix(p) === prefix)) {
        const takes = arg.prefixes.map((p) => kindOf(asPrefix(p))).join(' or ')
        return {
          ok: false,
          reason: `${String(handle)} in ${key} is ${kindOf(prefix)}; ${key} takes ${takes}`,
        }
      }
      resolved.push(id)
      const table = tableOfId(id)
      if (table !== null) named.set(`${table}:${id}`, { table, id })
    }
    args[key] = arg.shape === 'array' ? resolved : resolved[0]
  }
  return { ok: true, args, named: [...named.values()] }
}

type SchemaNode = Readonly<Record<string, unknown>>

const isNode = (value: unknown): value is SchemaNode =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const SUBSCHEMA_LISTS = ['anyOf', 'oneOf', 'allOf'] as const

// A record's additionalProperties is its value schema, which the SDK overwrites with false.
// Walks schema positions only, so a property named `default` or `type` is never read as a keyword.
function schemaFaults(node: unknown, path: string, faults: string[]): void {
  if (!isNode(node)) return
  if (Object.hasOwn(node, 'default')) faults.push(`${path} has a default`)
  if (node.type === 'object') {
    if (Object.hasOwn(node, 'propertyNames'))
      faults.push(`${path} is a record, which the SDK sends with no keys`)
    else if (node.additionalProperties !== false) faults.push(`${path} is not strict`)
  }
  if (isNode(node.properties))
    for (const [key, child] of Object.entries(node.properties))
      schemaFaults(child, `${path}.${key}`, faults)
  schemaFaults(node.items, `${path}[]`, faults)
  if (Array.isArray(node.prefixItems))
    node.prefixItems.forEach((child, i) => schemaFaults(child, `${path}[${i}]`, faults))
  schemaFaults(node.additionalProperties, `${path}{}`, faults)
  for (const list of SUBSCHEMA_LISTS) {
    const children = node[list]
    if (Array.isArray(children)) for (const child of children) schemaFaults(child, path, faults)
  }
  if (isNode(node.$defs))
    for (const [name, child] of Object.entries(node.$defs))
      schemaFaults(child, `${path}$defs.${name}`, faults)
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => sameValue(item, b[i]))
    )
  if (!isNode(a) || !isNode(b)) return false
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]))
  )
}

const EXTRA_KEY = '__extra__'

/** Test helper: deep-equal replay, additionalProperties false on every object, extra key refused. */
export function assertReplaySafe(
  schema: z.ZodObject,
  samples: readonly Record<string, unknown>[],
): void {
  if (samples.length === 0) throw new Error('assertReplaySafe: no samples to replay')
  try {
    z.toJSONSchema(schema)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`assertReplaySafe: no JSON Schema form, as with a transform: ${detail}`)
  }
  samples.forEach((sample, i) => {
    const parsed = schema.safeParse(sample)
    if (!parsed.success)
      throw new Error(`assertReplaySafe: sample ${i} doesn't parse: ${parsed.error.message}`)
    if (!sameValue(parsed.data, sample))
      throw new Error(
        `assertReplaySafe: sample ${i} doesn't replay as written: ${JSON.stringify(parsed.data)}`,
      )
    if (schema.safeParse({ ...sample, [EXTRA_KEY]: 'x' }).success)
      throw new Error(`assertReplaySafe: sample ${i} with an extra key is accepted`)
  })
  const faults: string[] = []
  schemaFaults(z.toJSONSchema(schema, { io: 'input' }), '(root)', faults)
  if (faults.length > 0) throw new Error(`assertReplaySafe: ${faults.join('; ')}`)
}
