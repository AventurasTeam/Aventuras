import { beforeEach, describe, expect, it } from 'vitest'

import {
  branches,
  emptyEntityState,
  entities,
  happenings,
  lore,
  stories,
  threads,
  type NewEntity,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { CloseIds } from './ids'
import { readRowTool, searchWorldTool } from './read-tools'
import { assertReplaySafe, type ReadAnswer, type ReadFields, type ToolContext } from './tool'

const BRANCH = 'br_read'
// Sorts before BRANCH: an unfiltered read finds the other branch's copy first.
const OTHER_BRANCH = 'br_other_read'

// Real uuid shapes: ids.show refuses an id it can't substitute.
const rowId = (prefix: string, n: number): string =>
  `${prefix}_00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const TOBIN = rowId('char', 1)
const MIRA = rowId('char', 2)
const WREN = rowId('char', 3) // never written: a row that's gone
const ELDER = rowId('char', 9) // the other branch's
const HARROW = rowId('loc', 1)
const FERRYHOUSE = rowId('loc', 2)
const LETTER = rowId('item', 1)
const SYNDICATE = rowId('fact', 1)
const CROSSING = rowId('hap', 1)
const TOLL_LAW = rowId('lore', 1)
const MISSING_TOLL = rowId('thr', 1)

const FULL_ID = /\b(?:char|loc|item|fact|lore|thr|hap|chap)_[0-9a-f]{8}-/

const READ_FIELDS: ReadFields = {
  character: ['description', 'state.voice', 'state.current_location_id'],
  lore: ['body'],
  happening: ['description'],
  thread: ['description'],
}

type SearchOutput = { matches: { id: string; line: string }[]; omitted?: number; note?: string }

let db: Awaited<ReturnType<typeof createTestDb>>['db']
let ids: CloseIds

function entity(
  id: string,
  kind: NewEntity['kind'],
  name: string,
  extra: Partial<NewEntity> = {},
  branchId = BRANCH,
): NewEntity {
  return {
    id,
    branchId,
    kind,
    name,
    status: 'active',
    injectionMode: 'auto',
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  }
}

function toolCtx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    db,
    branchId: BRANCH,
    endEntryId: 'entry_read_end',
    task: 'identity',
    part: 1,
    ids,
    readFields: READ_FIELDS,
    survivorOf: () => undefined,
    ...over,
  }
}

async function search(query: string): Promise<{ answer: ReadAnswer; out: SearchOutput }> {
  const answer = await searchWorldTool.read({ query }, toolCtx())
  return { answer, out: answer.output as SearchOutput }
}

const matchedIds = (out: SearchOutput) => out.matches.map((match) => ids.idOf(match.id))

beforeEach(async () => {
  ;({ db } = await createTestDb())
  await db
    .insert(stories)
    .values({ id: 's_read', title: 'The Crossing', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values([
    { id: BRANCH, storyId: 's_read', name: 'main', createdAt: 1 },
    { id: OTHER_BRANCH, storyId: 's_read', name: 'other', createdAt: 1 },
  ])
  // A fork keeps every row id. The other branch's copies go in first: an unfiltered read finds them first.
  await db
    .insert(entities)
    .values([
      entity(
        TOBIN,
        'character',
        'Other Tobin',
        { description: 'OTHER: a different ferryman.' },
        OTHER_BRANCH,
      ),
      entity(HARROW, 'location', 'Other Harrow', {}, OTHER_BRANCH),
    ])
  await db.insert(happenings).values({
    id: CROSSING,
    branchId: OTHER_BRANCH,
    title: 'The night crossing',
    description: 'OTHER: a day crossing.',
    createdAt: 1,
    updatedAt: 1,
  })
  await db.insert(lore).values({
    id: TOLL_LAW,
    branchId: OTHER_BRANCH,
    title: 'The other toll law',
    body: 'OTHER: no toll.',
    injectionMode: 'auto',
    createdAt: 1,
    updatedAt: 1,
  })
  await db.insert(entities).values([
    entity(TOBIN, 'character', 'Tobin', {
      description: 'An old ferryman who poles the night crossing.',
      keywords: ['old tobin', 'the ferryman'],
      state: {
        ...emptyEntityState('character'),
        traits: ['gruff'],
        voice: 'Gravel and drink.',
        current_location_id: HARROW,
        inventory: [LETTER],
      },
    }),
    entity(MIRA, 'character', 'Mira', {
      status: 'retired',
      description: 'A healer who left Harrow.',
    }),
    entity(HARROW, 'location', 'Harrow', {
      description: 'A ferry town low on the river.',
      keywords: ['ferry town'],
    }),
    entity(FERRYHOUSE, 'location', 'Ferryhouse', { description: 'A shed at the landing.' }),
    entity(LETTER, 'item', "Courier's letter", {
      description: 'Black wax over a cramped hand.',
      keywords: ['Sealed Letter'],
    }),
    entity(SYNDICATE, 'faction', 'The Syndicate', {
      description: 'They tax the ferry and the road.',
    }),
    entity(ELDER, 'character', 'Tobin the elder', { keywords: ['the ferryman'] }, OTHER_BRANCH),
  ])
  await db.insert(happenings).values({
    id: CROSSING,
    branchId: BRANCH,
    title: 'The night crossing',
    description: `The ferryman ${TOBIN} took her over at night.`,
    createdAt: 1,
    updatedAt: 1,
  })
  await db.insert(lore).values({
    id: TOLL_LAW,
    branchId: BRANCH,
    title: 'The toll law',
    body: 'The Syndicate taxes the ferry, the road and the bread.',
    injectionMode: 'auto',
    createdAt: 1,
    updatedAt: 1,
  })
  await db.insert(threads).values([
    {
      id: MISSING_TOLL,
      branchId: OTHER_BRANCH,
      title: 'The other missing toll',
      description: 'OTHER: the toll is paid.',
      status: 'active',
      injectionMode: 'auto',
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: MISSING_TOLL,
      branchId: BRANCH,
      title: 'The missing toll',
      description: 'Someone keeps the toll back.',
      status: 'active',
      injectionMode: 'auto',
      createdAt: 1,
      updatedAt: 1,
    },
  ])
  ids = new CloseIds()
})

describe('search_world', () => {
  it('finds a row by an alias the query holds whole, on its own branch only', async () => {
    const { out } = await search('Ask the ferryman about the toll')

    expect(matchedIds(out)).toEqual([TOBIN])
    expect(out.matches[0]!.line).toBe(
      'character: Tobin — An old ferryman who poles the night crossing.',
    )
  })

  it('finds a row by part of a keyword', async () => {
    const { out } = await search('sealed')

    expect(matchedIds(out)).toEqual([LETTER])
    expect(out.matches[0]!.line).toBe("item: Courier's letter — Black wax over a cramped hand.")
  })

  it('finds a happening by its title, a full id in its line swapped for a handle', async () => {
    const { out } = await search('crossing')

    expect(matchedIds(out)).toEqual([CROSSING])
    expect(out.matches[0]!.line).toBe(
      `happening: The night crossing — The ferryman ${ids.handleOf(TOBIN)} took her over at night.`,
    )
  })

  it('keeps word boundaries: a name inside a longer word is no match', async () => {
    const { out } = await search('a miracle cure')

    expect(out.matches).toEqual([])
  })

  it('finds a retired row, its status on its line', async () => {
    const { out } = await search('mira')

    expect(matchedIds(out)).toEqual([MIRA])
    expect(out.matches[0]!.line).toBe('character: Mira (retired) — A healer who left Harrow.')
  })

  it('lists name matches before keyword matches, each group by name', async () => {
    const aldous = rowId('char', 50) // a keyword match whose name sorts before the name match
    await db
      .insert(entities)
      .values(entity(aldous, 'character', 'Aldous', { keywords: ['ferry pass'] }))

    const { out } = await search('ferry')

    expect(matchedIds(out)).toEqual([FERRYHOUSE, aldous, HARROW, TOBIN])
  })

  it('stops at 20 matches and says how many it left out', async () => {
    await db
      .insert(entities)
      .values(
        Array.from({ length: 25 }, (_, i) =>
          entity(rowId('char', 100 + i), 'character', `Guard ${i + 1}`),
        ),
      )

    const { out } = await search('guard')

    expect(out.matches).toHaveLength(20)
    expect(out.omitted).toBe(5)
  })

  it('mints no handle for an id in a row it cut', async () => {
    const hidden = rowId('item', 90)
    await db
      .insert(entities)
      .values([
        ...Array.from({ length: 24 }, (_, i) =>
          entity(rowId('char', 100 + i), 'character', `Guard ${i + 1}`),
        ),
        entity(rowId('char', 200), 'character', 'Guard 9z', { description: `Holds ${hidden}.` }),
      ])

    const { out } = await search('guard')

    expect(out.omitted).toBe(5)
    expect(out.matches.map((match) => ids.nameOf(match.id))).not.toContain('Guard 9z')
    expect(ids.handleOf(hidden)).toBeUndefined()
  })

  it('answers a blank query with no match', async () => {
    const { answer, out } = await search('   ')

    expect(out.matches).toEqual([])
    expect(out.note).toContain('empty')
    expect(answer.read).toEqual([])
  })

  it('counts no match as read, and every id it hands back is a named handle', async () => {
    const { answer, out } = await search('ferry')

    expect(answer.read).toEqual([])
    expect(answer.rows).toEqual([])
    expect(out.matches.map((match) => ids.nameOf(match.id))).toEqual([
      'Ferryhouse',
      'Harrow',
      'Tobin',
    ])
    expect(JSON.stringify(answer.output)).not.toMatch(FULL_ID)
  })

  it('leaves omitted off when nothing was cut', async () => {
    const { out } = await search('ferry')

    expect(out).not.toHaveProperty('omitted')
  })

  it('finds a happening on its own branch only, though the other branch holds its id', async () => {
    const { out } = await search('crossing')

    expect(matchedIds(out)).toEqual([CROSSING])
    expect(out.matches[0]!.line).not.toContain('OTHER')
  })

  it('finds a mixed-case stored keyword from a lowercase query, whole or in part', async () => {
    const part = await search('sealed')
    const whole = await search('where is the sealed letter now')

    expect(matchedIds(part.out)).toEqual([LETTER])
    expect(matchedIds(whole.out)).toEqual([LETTER])
  })

  it('skips a keyword that is no string, and a keyword list that is no list', async () => {
    const beacon = rowId('item', 60)
    const lamp = rowId('item', 61)
    await db.insert(entities).values([
      entity(beacon, 'item', 'Beacon', {
        keywords: [7, null, 'Signal Fire'] as unknown as string[],
      }),
      entity(lamp, 'item', 'Lamp', { keywords: 'oops' as unknown as string[] }),
    ])

    const { out } = await search('signal fire')

    expect(matchedIds(out)).toEqual([beacon])
    expect((await search('lamp')).out.matches).toHaveLength(1)
  })

  it('swaps full ids for handles before it cuts the line, in text with no space to cut at', async () => {
    const cjk = rowId('hap', 70)
    const roll = rowId('hap', 71)
    await db.insert(happenings).values([
      {
        id: cjk,
        branchId: BRANCH,
        title: 'Lantern',
        description: `${'あ'.repeat(85)}${TOBIN}${'い'.repeat(40)}`,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: roll,
        branchId: BRANCH,
        title: 'Roll call',
        description: [TOBIN, MIRA, HARROW, LETTER, SYNDICATE].join(','),
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    await db.insert(entities).values(entity(rowId('loc', 72), 'location', `Gate of ${TOBIN}`))
    const fragment = /_[0-9a-f]{8}-/

    const lantern = (await search('lantern')).out.matches[0]!.line
    const call = (await search('roll call')).out.matches[0]!.line

    expect(lantern).toContain(ids.handleOf(TOBIN))
    expect(lantern).not.toMatch(fragment)
    expect(call).not.toMatch(fragment)
    expect(call).toContain(ids.handleOf(SYNDICATE))
    expect((await search('gate of')).out.matches[0]!.line).not.toMatch(FULL_ID)
  })
})

describe('read_row', () => {
  it("returns only the fields the task names for the row's kind, a ref as a named handle", async () => {
    const tobin = ids.show(TOBIN, 'Tobin')

    const answer = await readRowTool.read({ id: TOBIN }, toolCtx())

    const harrow = ids.handleOf(HARROW)
    expect(harrow).toMatch(/^l\d+$/)
    expect(answer.output).toEqual({
      id: tobin,
      kind: 'character',
      name: 'Tobin',
      fields: {
        description: 'An old ferryman who poles the night crossing.',
        'state.voice': 'Gravel and drink.',
        'state.current_location_id': harrow,
      },
      refs: { [harrow!]: 'Harrow' },
    })
    expect(answer.read).toEqual([{ table: 'entities', id: TOBIN }])
    expect(answer.rows).toEqual([{ table: 'entities', id: TOBIN, name: 'Tobin' }])
    expect(ids.nameOf(harrow!)).toBe('Harrow')
  })

  it('shows a character whose full id sits inside prose, by its handle and name', async () => {
    const sela = rowId('char', 4)
    await db
      .insert(entities)
      .values(
        entity(sela, 'character', 'Sela', { description: `Spoke with ${MIRA} at the ferry.` }),
      )
    expect(ids.handleOf(MIRA)).toBeUndefined()

    const answer = await readRowTool.read({ id: sela }, toolCtx())

    const mira = ids.handleOf(MIRA)!
    expect(mira).toMatch(/^c\d+$/)
    expect(answer.output).toMatchObject({
      fields: { description: `Spoke with ${mira} at the ferry.` },
      refs: { [mira]: 'Mira' },
    })
    expect(ids.nameOf(mira)).toBe('Mira')
    expect(JSON.stringify(answer.output)).not.toMatch(FULL_ID)
  })

  it('answers a row that is gone, with no refusal and nothing read', async () => {
    const wren = ids.show(WREN, 'Wren')

    const answer = await readRowTool.read({ id: WREN }, toolCtx())

    expect(answer.output).toEqual({ id: wren, gone: true, note: 'This row no longer exists.' })
    expect(answer.read).toEqual([])
    expect(answer.rows).toEqual([{ table: 'entities', id: WREN, name: 'Wren' }])
  })

  it('names the row a gone row was merged into', async () => {
    const wren = ids.show(WREN, 'Wren')

    const answer = await readRowTool.read(
      { id: WREN },
      toolCtx({
        survivorOf: (table, id) =>
          table === 'entities' && id === WREN ? { table: 'entities', id: TOBIN } : undefined,
      }),
    )

    const tobin = ids.handleOf(TOBIN)
    expect(answer.output).toEqual({
      id: wren,
      gone: true,
      survivor: tobin,
      note: `This row no longer exists: it was merged into ${tobin}. Read ${tobin} instead.`,
    })
    expect(ids.nameOf(tobin!)).toBe('Tobin')
    expect(answer.read).toEqual([])
  })

  it("answers that the task can't read a kind it names no fields for", async () => {
    const harrow = ids.show(HARROW, 'Harrow')

    const answer = await readRowTool.read({ id: HARROW }, toolCtx())

    expect(answer.output).toEqual({
      id: harrow,
      kind: 'location',
      name: 'Harrow',
      note: "This task can't read location rows.",
    })
    expect(answer.read).toEqual([])
  })

  it('reads a lore row and a happening, a full id in a text swapped for its handle', async () => {
    const law = await readRowTool.read({ id: TOLL_LAW }, toolCtx())
    const crossing = await readRowTool.read({ id: CROSSING }, toolCtx())

    expect(law.output).toEqual({
      id: ids.handleOf(TOLL_LAW),
      kind: 'lore',
      name: 'The toll law',
      fields: { body: 'The Syndicate taxes the ferry, the road and the bread.' },
    })
    expect(law.read).toEqual([{ table: 'lore', id: TOLL_LAW }])
    expect(crossing.output).toEqual({
      id: ids.handleOf(CROSSING),
      kind: 'happening',
      name: 'The night crossing',
      fields: { description: `The ferryman ${ids.handleOf(TOBIN)} took her over at night.` },
      refs: { [ids.handleOf(TOBIN)!]: 'Tobin' },
    })
    expect(crossing.read).toEqual([{ table: 'happenings', id: CROSSING }])
    expect(JSON.stringify([law.output, crossing.output])).not.toMatch(FULL_ID)
  })
})

describe('read_row on a forked story', () => {
  it("reads this branch's copy of a row whose id the other branch keeps", async () => {
    const tobin = await readRowTool.read({ id: TOBIN }, toolCtx())
    const law = await readRowTool.read({ id: TOLL_LAW }, toolCtx())
    const crossing = await readRowTool.read({ id: CROSSING }, toolCtx())
    const toll = await readRowTool.read({ id: MISSING_TOLL }, toolCtx())

    expect(tobin.output).toMatchObject({
      name: 'Tobin',
      fields: { description: 'An old ferryman who poles the night crossing.' },
    })
    expect(law.output).toMatchObject({ name: 'The toll law' })
    expect(crossing.output).toMatchObject({
      fields: { description: expect.not.stringContaining('OTHER') },
    })
    expect(toll.output).toMatchObject({
      kind: 'thread',
      name: 'The missing toll',
      fields: { description: 'Someone keeps the toll back.' },
    })
    expect(toll.read).toEqual([{ table: 'threads', id: MISSING_TOLL }])
  })

  it("names a ref by this branch's copy of its row", async () => {
    const answer = await readRowTool.read({ id: TOBIN }, toolCtx())

    expect((answer.output as { refs: Record<string, string> }).refs).toEqual({
      [ids.handleOf(HARROW)!]: 'Harrow',
    })
  })

  it('answers gone for a row only the other branch holds', async () => {
    const answer = await readRowTool.read({ id: ELDER }, toolCtx())

    expect(answer.output).toMatchObject({ gone: true })
    expect(answer.read).toEqual([])
  })

  it('reads a field the row lacks as null', async () => {
    const answer = await readRowTool.read(
      { id: TOBIN },
      toolCtx({
        readFields: { character: ['description', 'state.no_such_field', 'state.voice.x'] },
      }),
    )
    const bare = await readRowTool.read({ id: MIRA }, toolCtx())

    expect((answer.output as { fields: unknown }).fields).toEqual({
      description: 'An old ferryman who poles the night crossing.',
      'state.no_such_field': null,
      'state.voice.x': null,
    })
    expect((bare.output as { fields: unknown }).fields).toMatchObject({
      'state.voice': null,
      'state.current_location_id': null,
    })
  })
})

describe('the read tools', () => {
  it('declare strict schemas that replay what the model wrote', () => {
    expect(() =>
      assertReplaySafe(searchWorldTool.schema, [
        { query: 'old tobin' },
        { query: 'the capital' },
        { query: '  old tobin ' },
      ]),
    ).not.toThrow()
    expect(() =>
      assertReplaySafe(readRowTool.schema, [{ id: 'c1' }, { id: 'lo2' }, { id: ' c1 ' }]),
    ).not.toThrow()
  })

  it('declare their names, kinds and id arguments', () => {
    expect(searchWorldTool).toMatchObject({ kind: 'read', name: 'search_world' })
    expect(searchWorldTool.ids).toEqual({})
    expect(readRowTool).toMatchObject({ kind: 'read', name: 'read_row' })
    expect(readRowTool.ids).toEqual({
      id: { shape: 'single', prefixes: ['char', 'loc', 'item', 'fact', 'lore', 'thr', 'hap'] },
    })
  })
})
