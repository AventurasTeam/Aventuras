import { readFileSync } from 'node:fs'

import fg from 'fast-glob'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { branches, emptyEntityState, entities, lore, stories, type NewEntity } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import type { DbCtx, NoopMark, PipelineAction } from '../types'
import { applyDeltaAction } from './apply-delta-action'
import { resolveByActionKind, type HandlerOutcome } from './registry'

// Unmarked spellings C11 maps to `rejected`: a broken rule, never a value already stored or a row
// that went. `not-a-faction` is listed for setFactionStanding, which uses it as a rule only; the
// shared site in setCharacterFaction is pinned by its sample cases.
const RULE_REASONS: readonly string[] = [
  'location',
  'name-blank',
  'name-taken',
  'not-a-character',
  'not-a-faction',
  'not-a-location',
  'not-a-place-or-item',
  'not-unplaced',
  'partner-is-self',
  'partner-not-of-kind',
]

// Non-literal reasons that are a rule or user precedence, by their source text.
const RULE_EXPRESSIONS: readonly string[] = [
  'USER_EDITED_SINCE_PROSE',
  'PLACE_REFUSAL.retiredParent',
  'PLACE_REFUSAL.storyInside',
  'chainRefusal',
]

// A floor, not a count: fewer means the glob or the parse stopped reading the calls.
const KNOWN_NOOP_CALLS = 57

// The ten entity targets, partner-not-found, threads' status target, the relationship delete.
const KNOWN_NOT_FOUND_CALLS = 13

type NoopCall = {
  at: string
  /** The first argument's source text. */
  reason: string
  /** The first argument's value when it's a plain string literal. */
  literal: string | null
  marked: boolean
  /** The mark argument's source text, null when the call has none. */
  markText: string | null
}

function noopCalls(path: string, source: string): NoopCall[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const calls: NoopCall[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'noopRefusal'
    ) {
      const [reason, mark] = node.arguments
      const { line } = file.getLineAndCharacterOfPosition(node.getStart(file))
      calls.push({
        at: `${path}:${line + 1}`,
        reason: reason?.getText(file) ?? '',
        literal: reason !== undefined && ts.isStringLiteralLike(reason) ? reason.text : null,
        marked: mark !== undefined,
        markText: mark?.getText(file) ?? null,
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return calls
}

const isRuleRefusal = (call: NoopCall): boolean =>
  call.literal === null
    ? RULE_EXPRESSIONS.includes(call.reason)
    : RULE_REASONS.includes(call.literal)

const unmarked = (calls: readonly NoopCall[]): string[] =>
  calls.filter((call) => !call.marked && !isRuleRefusal(call)).map((c) => `${c.at} ${c.reason}`)

// A row that went is `gone`, bar the relationship delete whose missing pair is the state asked for.
const RESTATED_NOT_FOUND = '`delete target relationship ${bid}:${id} not found`'

const isNotFound = (call: NoopCall): boolean =>
  call.literal === 'partner-not-found' ||
  (call.reason.startsWith('`') && call.reason.includes('not found'))

const wrongNotFoundMark = (calls: readonly NoopCall[]): string[] =>
  calls
    .filter(isNotFound)
    .filter(
      (call) => call.markText !== (call.reason === RESTATED_NOT_FOUND ? "'restated'" : "'gone'"),
    )
    .map((c) => `${c.at} ${c.reason} marked ${c.markText}`)

const PROBE = [
  "noopRefusal('no-op lore patch')",
  'noopRefusal(reasonFor(id))',
  "noopRefusal('USER_EDITED_SINCE_PROSE')",
  "noopRefusal('not-a-character')",
  'noopRefusal(USER_EDITED_SINCE_PROSE)',
  'noopRefusal(PLACE_REFUSAL.storyInside)',
  "noopRefusal(\n  'relationship unchanged',\n  'restated',\n)",
  "noopRefusal('not-active', status === 'retired' ? 'restated' : undefined)",
].join('\n')

const NOT_FOUND_PROBE = [
  'noopRefusal(`rename target entities ${bid}:${id} not found`)',
  "noopRefusal('partner-not-found', 'restated')",
  "noopRefusal(`status target threads ${bid}:${id} not found`, 'gone')",
  "noopRefusal('partner-not-found', 'gone')",
  "noopRefusal(`delete target relationship ${bid}:${id} not found`, 'gone')",
  "noopRefusal(`delete target relationship ${bid}:${id} not found`, 'restated')",
  "noopRefusal('no-op lore patch', 'restated')",
].join('\n')

describe('noopRefusal marks: the scan (C11)', () => {
  it('flags an unmarked value or gone row and passes a mark, a rule or precedence', () => {
    const calls = noopCalls('probe.ts', PROBE)
    expect(calls).toHaveLength(8)
    expect(unmarked(calls)).toEqual([
      "probe.ts:1 'no-op lore patch'",
      'probe.ts:2 reasonFor(id)',
      "probe.ts:3 'USER_EDITED_SINCE_PROSE'",
    ])
  })

  it('flags a row-not-found refusal whose mark is not gone', () => {
    const calls = noopCalls('probe.ts', NOT_FOUND_PROBE)
    expect(calls).toHaveLength(7)
    expect(wrongNotFoundMark(calls)).toEqual([
      'probe.ts:1 `rename target entities ${bid}:${id} not found` marked null',
      "probe.ts:2 'partner-not-found' marked 'restated'",
      "probe.ts:5 `delete target relationship ${bid}:${id} not found` marked 'gone'",
    ])
  })

  it('finds every restated or gone noopRefusal in lib/actions marked', async () => {
    const paths = await fg(['lib/actions/**/*.ts'], {
      cwd: process.cwd(),
      ignore: ['**/*.test.ts', '**/__tests__/**'],
    })
    const calls = paths.flatMap((path) => noopCalls(path, readFileSync(path, 'utf8')))
    expect(calls.length, 'noopRefusal calls the scan read').toBeGreaterThanOrEqual(KNOWN_NOOP_CALLS)
    expect(unmarked(calls), 'restated or gone refusals with no mark').toEqual([])
  })

  it('marks every row-not-found refusal in lib/actions gone', async () => {
    const paths = await fg(['lib/actions/**/*.ts'], {
      cwd: process.cwd(),
      ignore: ['**/*.test.ts', '**/__tests__/**'],
    })
    const calls = paths.flatMap((path) => noopCalls(path, readFileSync(path, 'utf8')))
    expect(
      calls.filter(isNotFound).length,
      'not-found refusals the scan read',
    ).toBeGreaterThanOrEqual(KNOWN_NOT_FOUND_CALLS)
    expect(wrongNotFoundMark(calls), 'not-found refusals with the wrong mark').toEqual([])
  })
})

const BRANCH = 'br_1'

const entity = (
  id: string,
  kind: NewEntity['kind'],
  fields: Partial<NewEntity> = {},
): NewEntity => ({
  id,
  branchId: BRANCH,
  kind,
  name: id,
  status: 'active',
  injectionMode: 'auto',
  state: emptyEntityState(kind),
  createdAt: 1,
  updatedAt: 1,
  ...fields,
})

async function setup(): Promise<DbCtx> {
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: BRANCH, storyId: 'story_1', name: 'main', createdAt: 1 })
  await db.insert(entities).values([
    entity('char_1', 'character'),
    entity('char_2', 'character', { name: 'Mira' }),
    entity('char_3', 'character', { name: 'Mira' }),
    entity('char_staged', 'character', { status: 'staged' }),
    entity('char_retired', 'character', { status: 'retired' }),
    entity('char_bram', 'character', { name: 'Bram' }),
    // Flagged against char_3, a namesake through the keyword, so the flag still holds.
    entity('char_flagged', 'character', {
      name: 'the hooded stranger',
      keywords: ['Mira'],
      nameCollisionFlag: 1,
      nameCollisionPartnerId: 'char_3',
      nameCollisionReason: 'alike',
    }),
    entity('loc_1', 'location'),
    entity('item_1', 'item'),
  ])
  await db.insert(lore).values({
    id: 'lore_1',
    branchId: BRANCH,
    title: 'The old road',
    injectionMode: 'auto',
    createdAt: 1,
    updatedAt: 1,
  })
  return { db, runInTransaction }
}

async function outcomeOf(ctx: DbCtx, action: PipelineAction): Promise<HandlerOutcome> {
  const resolved = resolveByActionKind(action.kind)
  if (!resolved) throw new Error(`fixture: no handler for ${action.kind}`)
  return resolved.handler(action, BRANCH, { ...ctx, actionId: 'act_probe' })
}

const noop = (reason: string, mark?: NoopMark) =>
  mark === undefined
    ? { status: 'rejected', reason, code: 'noop' }
    : { status: 'rejected', reason, code: 'noop', mark }

const retire = (id: string): PipelineAction => ({
  kind: 'retireEntity',
  source: 'periodic_classifier',
  payload: { branchId: BRANCH, id, retiredReason: null, proseEntryId: null },
})

const join = (factionId: string): PipelineAction => ({
  kind: 'setCharacterFaction',
  source: 'periodic_classifier',
  payload: { branchId: BRANCH, id: 'char_1', factionId, proseEntryId: null },
})

const placeUnder = (parentId: string): PipelineAction => ({
  kind: 'placeLocation',
  source: 'periodic_classifier',
  payload: {
    branchId: BRANCH,
    id: 'loc_1',
    placement: { kind: 'under', parentId },
    proseEntryId: null,
  },
})

const returnFrom = (id: string): PipelineAction => ({
  kind: 'returnFromRetirement',
  source: 'periodic_classifier',
  payload: { branchId: BRANCH, id, proseEntryId: null },
})

const promote = (id: string): PipelineAction => ({
  kind: 'promoteStagedEntity',
  source: 'periodic_classifier',
  payload: { branchId: BRANCH, id, proseEntryId: null },
})

const raiseOn = (id: string): PipelineAction => ({
  kind: 'raiseCollisionFlag',
  source: 'periodic_classifier',
  payload: { branchId: BRANCH, id, partnerId: 'char_2', reason: 'name-taken', proseEntryId: null },
})

const restateLore: PipelineAction = {
  kind: 'updateLore',
  source: 'periodic_classifier',
  payload: { branchId: BRANCH, id: 'lore_1', patch: { title: 'The old road' } },
}

const linkToGone: PipelineAction = {
  kind: 'upsertCharacterRelationship',
  source: 'periodic_classifier',
  payload: {
    branchId: BRANCH,
    subjectId: 'char_1',
    objectId: 'char_gone',
    kind: 'ally',
    proseEntryId: null,
  },
}

describe('noopRefusal marks: sample handlers (C11)', () => {
  it.each<[string, PipelineAction, ReturnType<typeof noop>]>([
    ['retireEntity on a retired row', retire('char_retired'), noop('not-active', 'restated')],
    ['retireEntity on a staged row', retire('char_staged'), noop('not-active')],
    [
      'retireEntity on a missing row',
      retire('char_gone'),
      noop('retire target entities br_1:char_gone not found', 'gone'),
    ],
    [
      'returnFromRetirement on an active row',
      returnFrom('char_1'),
      noop('not-retired', 'restated'),
    ],
    ['returnFromRetirement on a staged row', returnFrom('char_staged'), noop('not-retired')],
    ['promoteStagedEntity on an active row', promote('char_1'), noop('not-staged', 'restated')],
    ['promoteStagedEntity on a retired row', promote('char_retired'), noop('not-staged')],
    ['updateLore restating the stored title', restateLore, noop('no-op lore patch', 'restated')],
    [
      'a link naming a missing row',
      linkToGone,
      noop('the link names a row that no longer exists', 'gone'),
    ],
    ['setCharacterFaction to a missing faction', join('fac_gone'), noop('not-a-faction', 'gone')],
    ['setCharacterFaction to a character', join('char_2'), noop('not-a-faction')],
    [
      'placeLocation under a missing parent',
      placeUnder('loc_gone'),
      noop('parent-not-a-place', 'gone'),
    ],
    ['placeLocation under an item', placeUnder('item_1'), noop('parent-not-a-place')],
    [
      'raiseCollisionFlag on a row whose flag holds',
      raiseOn('char_flagged'),
      noop('already-flagged', 'restated'),
    ],
    ['raiseCollisionFlag on no namesake', raiseOn('char_bram'), noop('not-namesakes')],
  ])('%s', async (_label, action, expected) => {
    const ctx = await setup()
    expect(await outcomeOf(ctx, action)).toStrictEqual(expected)
  })

  it('leaves the mark off a refusal the single path returns', async () => {
    const ctx = await setup()
    const result = await applyDeltaAction(
      { action: retire('char_retired'), actionId: 'act_1', branchId: BRANCH },
      ctx,
    )
    expect(result).toStrictEqual(noop('not-active'))
  })
})
