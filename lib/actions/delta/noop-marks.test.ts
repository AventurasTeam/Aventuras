import { readFileSync } from 'node:fs'

import fg from 'fast-glob'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'

import {
  branches,
  characterRelationships,
  emptyEntityState,
  entities,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  lore,
  stories,
  threads,
  type CollisionReason,
  type Entity,
  type NewEntity,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { entitiesStore } from '@/lib/stores'

import type { DbCtx, NoopMark, PipelineAction } from '../types'
import { applyDeltaAction } from './apply-delta-action'
import { noopRefusal, resolveByActionKind, type HandlerOutcome } from './registry'

// Literal reasons a null mark may carry: a broken rule, never a stored value or a gone row.
// `not-a-faction` is for setFactionStanding only; setCharacterFaction's site is pinned by samples.
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
  /** The mark argument's source text. */
  markText: string
}

// `null`, or a conditional whose every branch is: a mark no path through it sets.
function alwaysNull(node: ts.Expression): boolean {
  if (node.kind === ts.SyntaxKind.NullKeyword) return true
  if (ts.isParenthesizedExpression(node)) return alwaysNull(node.expression)
  return ts.isConditionalExpression(node) && alwaysNull(node.whenTrue) && alwaysNull(node.whenFalse)
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
        markText: mark === undefined ? '' : alwaysNull(mark) ? 'null' : mark.getText(file),
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

const nullMarked = (calls: readonly NoopCall[]): string[] =>
  calls
    .filter((call) => call.markText === 'null' && !isRuleRefusal(call))
    .map((c) => `${c.at} ${c.reason}`)

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
  "noopRefusal('no-op lore patch', null)",
  'noopRefusal(reasonFor(id), null)',
  "noopRefusal('USER_EDITED_SINCE_PROSE', null)",
  "noopRefusal('not-a-character', null)",
  'noopRefusal(USER_EDITED_SINCE_PROSE, null)',
  'noopRefusal(PLACE_REFUSAL.storyInside, null)',
  "noopRefusal(\n  'relationship unchanged',\n  'restated',\n)",
  "noopRefusal('not-active', status === 'retired' ? 'restated' : null)",
  "noopRefusal(\n  'already-flagged',\n  null,\n)",
  "noopRefusal('no-op entity patch', changed ? null : null)",
].join('\n')

const NOT_FOUND_PROBE = [
  'noopRefusal(`rename target entities ${bid}:${id} not found`, null)',
  "noopRefusal('partner-not-found', 'restated')",
  "noopRefusal(`status target threads ${bid}:${id} not found`, 'gone')",
  "noopRefusal('partner-not-found', 'gone')",
  "noopRefusal(`delete target relationship ${bid}:${id} not found`, 'gone')",
  "noopRefusal(`delete target relationship ${bid}:${id} not found`, 'restated')",
  "noopRefusal('no-op lore patch', 'restated')",
].join('\n')

describe('noopRefusal marks: the scan (C11)', () => {
  it('flags a null mark on a value or gone row and passes a mark, a rule or precedence', () => {
    const calls = noopCalls('probe.ts', PROBE)
    expect(calls).toHaveLength(10)
    expect(nullMarked(calls)).toEqual([
      "probe.ts:1 'no-op lore patch'",
      'probe.ts:2 reasonFor(id)',
      "probe.ts:3 'USER_EDITED_SINCE_PROSE'",
      "probe.ts:12 'already-flagged'",
      "probe.ts:16 'no-op entity patch'",
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

  it('finds no restated or gone noopRefusal in lib/actions passing a null mark', async () => {
    const paths = await fg(['lib/actions/**/*.ts'], {
      cwd: process.cwd(),
      ignore: ['**/*.test.ts', '**/__tests__/**'],
    })
    const calls = paths.flatMap((path) => noopCalls(path, readFileSync(path, 'utf8')))
    expect(calls.length, 'noopRefusal calls the scan read').toBeGreaterThanOrEqual(KNOWN_NOOP_CALLS)
    expect(nullMarked(calls), 'restated or gone refusals with a null mark').toEqual([])
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
    entity('char_1', 'character', {
      state: { ...emptyEntityState('character'), faction_id: 'fac_1' },
    }),
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
    entity('loc_inner', 'location', { state: { parent_location_id: 'loc_1' } }),
    entity('item_1', 'item', { state: { at_location_id: null, condition: 'rusted' } }),
    entity('fac_1', 'faction', { state: { standing: 'wary of strangers' } }),
  ])
  await db.insert(lore).values({
    id: 'lore_1',
    branchId: BRANCH,
    title: 'The old road',
    injectionMode: 'auto',
    createdAt: 1,
    updatedAt: 1,
  })
  await db
    .insert(happenings)
    .values({ id: 'hap_1', branchId: BRANCH, title: 'The fire', createdAt: 1, updatedAt: 1 })
  await db.insert(happeningInvolvements).values({
    id: 'inv_1',
    branchId: BRANCH,
    happeningId: 'hap_1',
    entityId: 'char_1',
    role: 'witness',
  })
  await db.insert(happeningAwareness).values({
    id: 'aw_1',
    branchId: BRANCH,
    happeningId: 'hap_1',
    characterId: 'char_1',
    source: 'witnessed',
  })
  await db.insert(threads).values({
    id: 'thr_1',
    branchId: BRANCH,
    title: 'Recover the relic',
    status: 'active',
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

const placeUnder = (parentId: string, id = 'loc_1'): PipelineAction => ({
  kind: 'placeLocation',
  source: 'periodic_classifier',
  payload: {
    branchId: BRANCH,
    id,
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

const raiseOn = (
  id: string,
  partnerId = 'char_2',
  reason: CollisionReason = 'name-taken',
): PipelineAction => ({
  kind: 'raiseCollisionFlag',
  source: 'periodic_classifier',
  payload: { branchId: BRANCH, id, partnerId, reason, proseEntryId: null },
})

const restateLore: PipelineAction = {
  kind: 'updateLore',
  source: 'periodic_classifier',
  payload: { branchId: BRANCH, id: 'lore_1', patch: { title: 'The old road' } },
}

const restateCondition: PipelineAction = {
  kind: 'updateEntityCondition',
  source: 'periodic_classifier',
  payload: { branchId: BRANCH, id: 'item_1', condition: 'rusted' },
}

const restateKeyword: PipelineAction = {
  kind: 'appendEntityKeywords',
  source: 'periodic_classifier',
  payload: { branchId: BRANCH, id: 'char_flagged', keywords: ['Mira'], proseEntryId: null },
}

const restateName: PipelineAction = {
  kind: 'renameEntity',
  source: 'periodic_classifier',
  payload: { branchId: BRANCH, id: 'char_bram', name: 'Bram', proseEntryId: null },
}

const restateStanding: PipelineAction = {
  kind: 'setFactionStanding',
  source: 'periodic_classifier',
  payload: { branchId: BRANCH, id: 'fac_1', standing: 'wary of strangers', proseEntryId: null },
}

const restateAwareness: PipelineAction = {
  kind: 'upsertHappeningAwareness',
  source: 'periodic_classifier',
  payload: {
    branchId: BRANCH,
    characterId: 'char_1',
    happeningId: 'hap_1',
    source: 'witnessed',
    proseEntryId: null,
  },
}

const restateRole: PipelineAction = {
  kind: 'updateHappeningInvolvement',
  source: 'periodic_classifier',
  payload: { branchId: BRANCH, id: 'inv_1', patch: { role: 'witness' } },
}

const restateThreadStatus: PipelineAction = {
  kind: 'setThreadStatus',
  source: 'periodic_classifier',
  payload: { branchId: BRANCH, id: 'thr_1', status: 'active', proseEntryId: null },
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
      'raiseCollisionFlag restating the flag it holds',
      raiseOn('char_flagged', 'char_3', 'alike'),
      noop('already-flagged', 'restated'),
    ],
    [
      'raiseCollisionFlag on a row flagged against another partner',
      raiseOn('char_flagged', 'char_2', 'alike'),
      noop('already-flagged'),
    ],
    [
      'raiseCollisionFlag on the same partner for another reason',
      raiseOn('char_flagged', 'char_3', 'name-taken'),
      noop('already-flagged'),
    ],
    ['raiseCollisionFlag on no namesake', raiseOn('char_bram'), noop('not-namesakes')],
    [
      'updateEntityCondition restating the stored condition',
      restateCondition,
      noop('no-op state patch for entities br_1:item_1', 'restated'),
    ],
    [
      'appendEntityKeywords restating a held keyword',
      restateKeyword,
      noop('no-new-keywords', 'restated'),
    ],
    [
      'setCharacterFaction to the faction it holds',
      join('fac_1'),
      noop('faction-unchanged', 'restated'),
    ],
    [
      'placeLocation under the parent it has',
      placeUnder('loc_1', 'loc_inner'),
      noop('placement-unchanged', 'restated'),
    ],
    ['renameEntity to the name it has', restateName, noop('name-unchanged', 'restated')],
    [
      'setFactionStanding restating the stored standing',
      restateStanding,
      noop('standing-unchanged', 'restated'),
    ],
    [
      'upsertHappeningAwareness restating the stored source',
      restateAwareness,
      noop('awareness unchanged', 'restated'),
    ],
    [
      'updateHappeningInvolvement restating the stored role',
      restateRole,
      noop('involvement unchanged', 'restated'),
    ],
    [
      'setThreadStatus to the status it has',
      restateThreadStatus,
      noop('status-unchanged', 'restated'),
    ],
  ])('%s', async (_label, action, expected) => {
    const ctx = await setup()
    expect(await outcomeOf(ctx, action)).toStrictEqual(expected)
  })

  describe('promoteStagedEntity on a staged row the store holds active', () => {
    afterEach(() => entitiesStore.__reset())

    it('stays a rule refusal, since a stale store proves no write landed', async () => {
      const ctx = await setup()
      entitiesStore.hydrate(BRANCH, [
        { ...entity('char_staged', 'character'), status: 'active' } as Entity,
      ])
      expect(await outcomeOf(ctx, promote('char_staged'))).toStrictEqual(noop('not-staged'))
    })
  })

  describe('promoteStagedEntity on a staged row another branch holds active', () => {
    afterEach(() => entitiesStore.__reset())

    it('lands, since the store copy is not its branch', async () => {
      const ctx = await setup()
      entitiesStore.hydrate('br_other', [
        { ...entity('char_staged', 'character'), branchId: 'br_other', status: 'active' } as Entity,
      ])
      expect(await outcomeOf(ctx, promote('char_staged'))).toMatchObject({
        status: 'ok',
        targetTable: 'entities',
        targetId: 'char_staged',
        op: 'update',
      })
    })
  })

  describe('promoteStagedEntity on a retired row the store holds active', () => {
    afterEach(() => entitiesStore.__reset())

    it('stays a rule refusal', async () => {
      const ctx = await setup()
      entitiesStore.hydrate(BRANCH, [
        { ...entity('char_retired', 'character'), status: 'active' } as Entity,
      ])
      expect(await outcomeOf(ctx, promote('char_retired'))).toStrictEqual(noop('not-staged'))
    })
  })

  describe('upsertCharacterRelationship on a pair already stored', () => {
    const restateOne: PipelineAction = {
      kind: 'upsertCharacterRelationship',
      source: 'periodic_classifier',
      payload: {
        branchId: BRANCH,
        subjectId: 'char_1',
        objectId: 'char_2',
        kind: ' Ally ',
        proseEntryId: null,
      },
    }
    const restateBoth: PipelineAction = {
      kind: 'upsertCharacterRelationship',
      source: 'periodic_classifier',
      payload: {
        branchId: BRANCH,
        subjectId: 'char_1',
        objectId: 'char_2',
        kind: 'ally',
        inverseKind: 'rival',
      },
    }

    async function seeded(): Promise<DbCtx> {
      const ctx = await setup()
      await ctx.db.insert(characterRelationships).values({
        id: 'rel_1',
        branchId: BRANCH,
        aId: 'char_1',
        bId: 'char_2',
        kind: 'ally',
        inverseKind: 'rival',
        createdAt: 1,
        updatedAt: 1,
      })
      return ctx
    }

    it('reads a single-view repeat as restated', async () => {
      const ctx = await seeded()
      expect(await outcomeOf(ctx, restateOne)).toStrictEqual(
        noop('relationship unchanged', 'restated'),
      )
    })

    it('reads a both-views repeat as restated', async () => {
      const ctx = await seeded()
      expect(await outcomeOf(ctx, restateBoth)).toStrictEqual(
        noop('relationship unchanged', 'restated'),
      )
    })
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

describe('noopRefusal marks: the types (C11)', () => {
  it('states a mark or null at every noop, and a mark rides only on a noop', () => {
    // @ts-expect-error a noop that states no mark
    const unstated = () => noopRefusal('not-a-character')
    const outcomes: HandlerOutcome[] = [
      noopRefusal('not-a-character', null),
      // @ts-expect-error a mark on another code
      { status: 'rejected', reason: 'gone', code: 'not-found', mark: 'gone' },
      // @ts-expect-error a mark with no code
      { status: 'rejected', reason: 'gone', mark: 'gone' },
    ]
    expect(unstated).toBeTypeOf('function')
    expect(outcomes[0]).toStrictEqual(noop('not-a-character'))
  })
})
