import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'

import { CloseIds } from './ids'
import {
  assertReplaySafe,
  readToolSchema,
  resolveIdArgs,
  tableOfId,
  toolStepTools,
  writeToolSchema,
  type IdArgs,
  type ReadTool,
  type WritePlan,
  type WriteTool,
  type WriteToolSchema,
} from './tool'

const CHAR_A = 'char_11111111-1111-4111-8111-111111111111'
const CHAR_B = 'char_22222222-2222-4222-8222-222222222222'
const CHAR_C = 'char_33333333-3333-4333-8333-333333333333'
const LOC_A = 'loc_44444444-4444-4444-8444-444444444444'
const LORE_A = 'lore_55555555-5555-4555-8555-555555555555'
const ENTRY_1 = 'entry_66666666-6666-4666-8666-666666666661'

// t1; c1 Wren, c2 Tobin, c3 the reeve; l1 Harrow; lo1 the toll law.
function shownIds(): CloseIds {
  const ids = new CloseIds()
  ids.showTurns([ENTRY_1])
  ids.show(CHAR_A, 'Wren')
  ids.show(CHAR_B, 'Tobin')
  ids.show(CHAR_C, 'The reeve')
  ids.show(LOC_A, 'Harrow')
  ids.show(LORE_A, 'The toll law')
  return ids
}

const MERGE_SHAPE = {
  keep: z.string(),
  absorb: z.array(z.string()),
  place: z.string().nullable().optional(),
}

const mergeRows: WriteTool<typeof MERGE_SHAPE> = {
  kind: 'write',
  name: 'merge_rows',
  description: 'Merge duplicate characters into one.',
  schema: writeToolSchema(MERGE_SHAPE),
  ids: {
    keep: { shape: 'single', prefixes: ['char_', 'fact_'] },
    absorb: { shape: 'array', prefixes: ['char_'] },
    place: { shape: 'single', prefixes: ['loc'] },
  },
  plan: async () => ({ kind: 'refused', reason: 'unused here', rows: [] }),
}

const READ_TURN_SCHEMA = readToolSchema({ turn: z.string() })

const readTurn: ReadTool<typeof READ_TURN_SCHEMA> = {
  kind: 'read',
  name: 'read_turn',
  description: 'Read one turn.',
  schema: READ_TURN_SCHEMA,
  ids: { turn: { shape: 'single', prefixes: ['entry_'] } },
  read: async () => ({ output: null, rows: [], read: [] }),
}

const MERGE_SAMPLE = {
  keep: 'c1',
  absorb: ['c2'],
  place: null,
  turns: ['t1'],
  why: 'The same man.',
}

describe('writeToolSchema', () => {
  it('adds turns and why to a strict shape', () => {
    const schema = writeToolSchema({ id: z.string() })
    expect(Object.keys(schema.shape)).toEqual(['id', 'turns', 'why'])
    expect(schema.safeParse({ id: 'c1', turns: ['t1'], why: 'w' }).success).toBe(true)
    expect(schema.safeParse({ id: 'c1', turns: ['t1'], why: 'w', note: 'x' }).success).toBe(false)
  })

  it('refuses a shape that brings its own turns or why', () => {
    expect(() => writeToolSchema({ turns: z.string() })).toThrow(/turns and why/)
    expect(() => writeToolSchema({ why: z.string() })).toThrow(/turns and why/)
  })
})

describe('readToolSchema', () => {
  it('is strict and adds nothing', () => {
    const schema = readToolSchema({ id: z.string() })
    expect(Object.keys(schema.shape)).toEqual(['id'])
    expect(schema.safeParse({ id: 'c1', why: 'w' }).success).toBe(false)
  })
})

describe('assertReplaySafe', () => {
  it('passes a strict schema whose samples parse to themselves, in any key order', () => {
    const schema = writeToolSchema({
      id: z.string(),
      state: z
        .strictObject({ voice: z.string().optional(), traits: z.array(z.string()) })
        .optional(),
      status: z.enum(['active', 'retired']).nullable(),
    })
    expect(() =>
      assertReplaySafe(schema, [
        { id: 'c1', status: null, turns: ['t1'], why: 'w' },
        {
          why: 'w',
          turns: ['t1', 't2'],
          status: 'active',
          state: { traits: ['wary'], voice: 'low' },
          id: 'c1',
        },
      ]),
    ).not.toThrow()
  })

  it('refuses a plain top-level object, which strips a key the model added', () => {
    expect(() => assertReplaySafe(z.object({ id: z.string() }), [{ id: 'c1' }])).toThrow(
      /extra key/,
    )
  })

  it('refuses a plain object nested in a strict one', () => {
    const schema = z.strictObject({ state: z.object({ voice: z.string() }) })
    expect(() => assertReplaySafe(schema, [{ state: { voice: 'low' } }])).toThrow(
      /state is not strict/,
    )
  })

  it('refuses a record, which the SDK sends to the model with no keys', () => {
    const schema = z.strictObject({ tags: z.record(z.string(), z.string()) })
    expect(() => assertReplaySafe(schema, [{ tags: { mood: 'wary' } }])).toThrow(
      '(root).tags is a record, which the SDK sends with no keys',
    )
  })

  it('refuses a plain object in a record value', () => {
    const schema = z.strictObject({ byName: z.record(z.string(), z.object({ voice: z.string() })) })
    expect(() => assertReplaySafe(schema, [{ byName: { Wren: { voice: 'low' } } }])).toThrow(
      '(root).byName{} is not strict',
    )
  })

  it('refuses a plain object in array items', () => {
    const schema = z.strictObject({ rows: z.array(z.object({ id: z.string() })) })
    expect(() => assertReplaySafe(schema, [{ rows: [{ id: 'c1' }] }])).toThrow(
      '(root).rows[] is not strict',
    )
  })

  it('refuses a plain object in a tuple, naming its position', () => {
    const schema = z.strictObject({ pair: z.tuple([z.string(), z.object({ id: z.string() })]) })
    expect(() => assertReplaySafe(schema, [{ pair: ['a', { id: 'c1' }] }])).toThrow(
      '(root).pair[1] is not strict',
    )
  })

  it('refuses a plain object in a union member', () => {
    const schema = z.strictObject({ ref: z.union([z.string(), z.object({ id: z.string() })]) })
    expect(() => assertReplaySafe(schema, [{ ref: { id: 'c1' } }])).toThrow(
      '(root).ref is not strict',
    )
  })

  it('refuses a plain object in an intersection', () => {
    const schema = z.strictObject({
      ref: z.intersection(z.object({ id: z.string() }), z.object({ name: z.string() })),
    })
    expect(() => assertReplaySafe(schema, [{ ref: { id: 'c1', name: 'Wren' } }])).toThrow(
      '(root).ref is not strict',
    )
  })

  it('refuses a plain object in an exclusive union', () => {
    const schema = z.strictObject({
      ref: z.xor([z.string(), z.object({ id: z.string() })]),
    })
    expect(() => assertReplaySafe(schema, [{ ref: { id: 'c1' } }])).toThrow(
      '(root).ref is not strict',
    )
  })

  it('refuses a plain object in a recursive schema, naming its definition', () => {
    type Tree = { name: string; kids: Tree[] }
    const tree: z.ZodType<Tree> = z.lazy(() => z.object({ name: z.string(), kids: z.array(tree) }))
    const schema = z.strictObject({ tree })
    expect(() => assertReplaySafe(schema, [{ tree: { name: 'a', kids: [] } }])).toThrow(
      /\(root\)\$defs\.\w+ is not strict/,
    )
  })

  it('refuses a default, even when every sample sets the key', () => {
    const schema = z.strictObject({ status: z.string().default('active') })
    expect(() => assertReplaySafe(schema, [{ status: 'retired' }])).toThrow(/status has a default/)
  })

  it('refuses a string overwrite that changes what the model wrote', () => {
    const schema = z.strictObject({ name: z.string().trim() })
    expect(() => assertReplaySafe(schema, [{ name: '  Wren ' }])).toThrow(/doesn't replay/)
  })

  it('refuses a transform', () => {
    const schema = z.strictObject({ name: z.string().transform((s) => s.length) })
    expect(() => assertReplaySafe(schema, [{ name: 'Wren' }])).toThrow(/JSON Schema/)
  })

  it('refuses a sample that does not parse, and no samples at all', () => {
    const schema = z.strictObject({ id: z.string() })
    expect(() => assertReplaySafe(schema, [{ id: 1 }])).toThrow(/doesn't parse/)
    expect(() => assertReplaySafe(schema, [])).toThrow(/no samples/)
  })
})

describe('WriteTool and ReadTool (checked by tsc)', () => {
  const SHAPE = { id: z.string(), absorb: z.array(z.string()), count: z.number() }
  const plan = async (): Promise<WritePlan> => ({ kind: 'refused', reason: 'unused', rows: [] })
  const write = (ids: IdArgs<WriteToolSchema<typeof SHAPE>>): WriteTool<typeof SHAPE> => ({
    kind: 'write',
    name: 'w',
    description: '',
    schema: writeToolSchema(SHAPE),
    ids,
    plan,
  })

  it('keys id arguments by the schema, each shaped as its value', () => {
    const tools = () => [
      write({ id: { shape: 'single', prefixes: ['char'] } }),
      write({ absorb: { shape: 'array', prefixes: ['char'] } }),
      // @ts-expect-error a key the schema lacks: its handles would reach plan unresolved
      write({ idd: { shape: 'single', prefixes: ['char'] } }),
      // @ts-expect-error a string takes one handle
      write({ id: { shape: 'array', prefixes: ['char'] } }),
      // @ts-expect-error a string array takes a list
      write({ absorb: { shape: 'single', prefixes: ['char'] } }),
      // @ts-expect-error a number holds no handle
      write({ count: { shape: 'single', prefixes: ['char'] } }),
      // @ts-expect-error nor does a read schema's key it lacks
      ((ids: IdArgs<typeof READ_TURN_SCHEMA>) => ids)({ id: { shape: 'single', prefixes: [] } }),
    ]
    expect(tools).toBeTypeOf('function')
  })

  it('takes only a schema writeToolSchema built, and plans from its output', () => {
    const strict = z.strictObject(SHAPE)
    const tool = (): WriteTool<typeof SHAPE> => ({
      kind: 'write',
      name: 'w',
      description: '',
      // @ts-expect-error a schema without turns and why
      schema: strict,
      ids: {},
      plan,
    })
    expect(tool).toBeTypeOf('function')
    expectTypeOf<Parameters<WriteTool<typeof SHAPE>['plan']>[0]>().toEqualTypeOf<{
      id: string
      absorb: string[]
      count: number
      turns: string[]
      why: string
    }>()
  })
})

describe('toolStepTools', () => {
  it("gives the step each tool's description and schema, by name", () => {
    const tools = toolStepTools([mergeRows, readTurn])
    expect(Object.keys(tools)).toEqual(['merge_rows', 'read_turn'])
    expect(tools.merge_rows).toEqual({
      description: mergeRows.description,
      inputSchema: mergeRows.schema,
    })
    expect(tools.read_turn.inputSchema).toBe(readTurn.schema)
  })

  it('refuses a tool listed twice', () => {
    expect(() => toolStepTools([mergeRows, mergeRows])).toThrow(/merge_rows/)
  })
})

describe('tableOfId', () => {
  it('maps each prefix a close writes to its table, and nothing else', () => {
    expect(
      [CHAR_A, LOC_A, 'item_x', 'fact_x', LORE_A, 'thr_x', 'hap_x', 'haw_x'].map(tableOfId),
    ).toEqual([
      'entities',
      'entities',
      'entities',
      'entities',
      'lore',
      'threads',
      'happenings',
      'happening_awareness',
    ])
    expect([ENTRY_1, 'chap_x', 'nounderscore'].map(tableOfId)).toEqual([null, null, null])
  })
})

describe('resolveIdArgs', () => {
  it('resolves single and array id arguments and names each row once', () => {
    const resolved = resolveIdArgs(
      { ...MERGE_SAMPLE, absorb: ['c2', '[c3]', 'c2'], place: 'l1' },
      mergeRows,
      shownIds(),
    )
    expect(resolved).toEqual({
      ok: true,
      args: {
        keep: CHAR_A,
        absorb: [CHAR_B, CHAR_C, CHAR_B],
        place: LOC_A,
        turns: ['t1'],
        why: 'The same man.',
      },
      named: [
        { table: 'entities', id: CHAR_A },
        { table: 'entities', id: CHAR_B },
        { table: 'entities', id: CHAR_C },
        { table: 'entities', id: LOC_A },
      ],
    })
  })

  it('leaves a null or absent id argument as it is', () => {
    const ids = shownIds()
    expect(resolveIdArgs(MERGE_SAMPLE, mergeRows, ids)).toMatchObject({
      ok: true,
      args: { place: null },
    })
    expect(
      resolveIdArgs({ keep: 'c1', absorb: [], turns: ['t1'], why: 'w' }, mergeRows, ids),
    ).toEqual({
      ok: true,
      args: { keep: CHAR_A, absorb: [], turns: ['t1'], why: 'w' },
      named: [{ table: 'entities', id: CHAR_A }],
    })
  })

  it('rejects a handle the close never showed, naming it', () => {
    const resolved = resolveIdArgs({ ...MERGE_SAMPLE, absorb: ['c2', 'c9'] }, mergeRows, shownIds())
    expect(resolved).toEqual({ ok: false, reason: expect.stringContaining('c9 in absorb') })
  })

  it('rejects an id of a kind the argument does not take', () => {
    const resolved = resolveIdArgs({ ...MERGE_SAMPLE, keep: 'lo1' }, mergeRows, shownIds())
    expect(resolved).toEqual({
      ok: false,
      reason: 'lo1 in keep is a lore row; keep takes a character or a faction',
    })
  })

  it('refuses a full id without echoing it back', () => {
    const full = 'char_99999999-9999-4999-8999-999999999999'
    const ids = shownIds()
    const single = resolveIdArgs({ ...MERGE_SAMPLE, keep: full }, mergeRows, ids)
    const inList = resolveIdArgs({ ...MERGE_SAMPLE, absorb: ['c2', `[${full}]`] }, mergeRows, ids)
    const reason = 'keep takes a short id as shown (c1, lo2…), not a full id'
    expect(single).toEqual({ ok: false, reason })
    expect(inList).toEqual({ ok: false, reason: reason.replace('keep', 'absorb') })
  })

  it('resolves a turn handle without naming a row', () => {
    expect(resolveIdArgs({ turn: 't1' }, readTurn, shownIds())).toEqual({
      ok: true,
      args: { turn: ENTRY_1 },
      named: [],
    })
  })
})
