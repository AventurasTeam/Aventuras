import { afterEach, describe, expect, it, vi } from 'vitest'

import { keywordPairsFlagReason, keywordUserAddedReason } from '@/lib/actions/delta/keyword-authors'
import { USER_EDITED_SINCE_PROSE, type GuardRow } from '@/lib/actions/types'
import { CLOSE_REASON_KEYS } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { PARENT_CHAIN_BROKEN, PARENT_CYCLE, PLACE_REFUSAL } from '@/lib/world'

import { FREQUENT_PIN_LOWERED, NO_START_PIN, PIN_RAISE_TOO_LARGE } from './awareness-tools'
import { commonChecks, createReadSet } from './common-checks'
import { sentList, softCapReason } from './fields'
import { MERGE_REFUSAL as HAPPENING_MERGE_REFUSAL } from './happening-tools'
import { CloseIds } from './ids'
import { keywordsRefusal, termHandleReason } from './keyword-args'
import { LORE_REFUSAL } from './lore-tools'
import { keyedReason, ledgerReasonKey } from './reason-key'
import { turnInTextReason } from './text-checks'
import { mergeThreadsTool } from './thread-tools'
import { resolveIdArgs } from './tool'
import { CLOSE_REASON } from './verdict'

const ENTRY_1 = 'entry_11111111-1111-4111-8111-111111111111'
const ENTRY_2 = 'entry_22222222-2222-4222-8222-222222222222'
const CHAR_A = 'char_33333333-3333-4333-8333-333333333333'
const THREAD_A = 'thr_44444444-4444-4444-8444-444444444444'
const LORE_A = 'lore_55555555-5555-4555-8555-555555555555'

afterEach(() => {
  vi.restoreAllMocks()
})

// t1 is the task's only turn, t2 a turn it wasn't shown; c1 is read, lo1 isn't.
function shown() {
  const ids = new CloseIds()
  ids.showTurns([ENTRY_1, ENTRY_2])
  ids.show(CHAR_A, 'Wren')
  ids.show(THREAD_A, 'The letter')
  ids.show(LORE_A, 'The toll law')
  const readSet = createReadSet()
  readSet.add([{ table: 'entities', id: CHAR_A }])
  return { ids, taskEntryIds: [ENTRY_1], readSet, survivorOf: () => undefined }
}

function checkReason(turns: unknown, why: unknown, unread = false): string {
  const ctx = shown()
  const named: GuardRow[] = unread ? [{ table: 'lore', id: LORE_A }] : []
  const check = commonChecks({ turns, why }, named, ctx)
  if (check.ok || check.reason === undefined) throw new Error('commonChecks gave no reason')
  return check.reason
}

function idReason(input: Record<string, unknown>): string {
  const resolved = resolveIdArgs(input, mergeThreadsTool, shown().ids)
  if (resolved.ok) throw new Error('resolveIdArgs resolved')
  return resolved.reason
}

describe('keyedReason', () => {
  it('leads the text with its key', () => {
    expect(keyedReason('unread', "c1 hasn't been read")).toBe("unread: c1 hasn't been read")
  })
})

const CALL = { actionId: 'act_close_reasons', task: 'lore', tool: 'create_lore' } as const

describe('ledgerReasonKey', () => {
  it('reads a bare key, and a keyed text, as its key', () => {
    const warn = vi.spyOn(logger, 'warn')
    expect(ledgerReasonKey('not-a-faction', CALL)).toBe('not-a-faction')
    expect(ledgerReasonKey('title-taken: lo2 already holds this title: keep it', CALL)).toBe(
      'title-taken',
    )
    expect(warn).not.toHaveBeenCalled()
  })

  it.each([
    ['a group rejection', 'branch mismatch: delta br_1 vs target br_2'],
    ['a text whose head is no key', 't3 is a turn: cite turns in turns, never in the text'],
    ['an unknown bare code', 'over-test-cap'],
  ])('reads %s as other and logs it raw, with its call', (_label, reason) => {
    const warn = vi.spyOn(logger, 'warn')
    expect(ledgerReasonKey(reason, CALL)).toBe('other')
    expect(warn).toHaveBeenCalledWith(
      'memory.close_reason_unkeyed',
      { reason, task: 'lore', tool: 'create_lore' },
      { actionId: 'act_close_reasons' },
    )
  })

  it('reads every key, bare or keyed, as itself', () => {
    const warn = vi.spyOn(logger, 'warn')
    for (const key of CLOSE_REASON_KEYS) {
      expect(ledgerReasonKey(key, CALL)).toBe(key)
      expect(ledgerReasonKey(keyedReason(key, 'some text: with a colon'), CALL)).toBe(key)
    }
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('the reasons a close records', () => {
  it.each<[string, () => string, string]>([
    ['an empty turns', () => checkReason([], 'w'), 'turns-empty'],
    ['a full id in turns', () => checkReason([ENTRY_1], 'w'), 'turns-full-id'],
    ['a row handle in turns', () => checkReason(['c1'], 'w'), 'not-a-turn'],
    ['a turn the task was not shown', () => checkReason(['t2'], 'w'), 'turn-not-shown'],
    ['an empty why', () => checkReason(['t1'], ' '), 'why-empty'],
    ['an unread row', () => checkReason(['t1'], 'w', true), 'unread'],
    ['a list where one id goes', () => idReason({ keep: ['th1'], absorb: [] }), 'id-shape'],
    ['a full id', () => idReason({ keep: THREAD_A, absorb: [] }), 'id-full'],
    ['an unknown handle', () => idReason({ keep: 'th9', absorb: [] }), 'id-unknown'],
    ['a handle of the wrong kind', () => idReason({ keep: 'c1', absorb: [] }), 'id-wrong-kind'],
    ['a turn in a text', () => turnInTextReason('t3'), 'turn-in-text'],
    ['a handle in a keyword', () => termHandleReason('c1', 'c1'), 'keyword-holds-id'],
    [
      'a term in both lists',
      () => keywordsRefusal({ add: ['Gate'], remove: ['gate'] }, shown().ids) ?? '',
      'keyword-in-both',
    ],
    ['a list over its cap', () => softCapReason('traits'), 'over-soft-cap'],
    [
      'a joined list over its cap',
      () => softCapReason('traits', sentList([Array(12).fill('a').join('","')])),
      'over-soft-cap',
    ],
    ['the user edited since', () => USER_EDITED_SINCE_PROSE, 'user-edited-since-prose'],
    ['a later turn', () => CLOSE_REASON.laterTurn, 'later-turn'],
    ['a gone row', () => CLOSE_REASON.rowGone, 'row-gone'],
    ['a lore title another row holds', () => LORE_REFUSAL.titleTaken, 'title-taken'],
    ['a removal of a user term', () => keywordUserAddedReason('the toll'), 'keyword-user-added'],
    [
      'a removal breaking a flag pair',
      () => keywordPairsFlagReason('the toll', 'Bram'),
      'keyword-pairs-flag',
    ],
    ['a retired parent', () => PLACE_REFUSAL.retiredParent, 'retired-parent'],
    ['a story hidden inside', () => PLACE_REFUSAL.storyInside, 'story-inside'],
    ['a parent cycle', () => PARENT_CYCLE, 'parent-cycle'],
    ['a broken parent chain', () => PARENT_CHAIN_BROKEN, 'parent-chain-broken'],
    [
      'a happening merge absorbing nothing',
      () => HAPPENING_MERGE_REFUSAL.emptyAbsorb,
      'merge-absorb-empty',
    ],
    [
      'a happening merge absorbing its keep',
      () => HAPPENING_MERGE_REFUSAL.keepAbsorbed,
      'merge-keep-absorbed',
    ],
    [
      'a happening merge naming one twice',
      () => HAPPENING_MERGE_REFUSAL.repeated,
      'merge-repeated',
    ],
    [
      "a happening merge reaching outside keep's cluster",
      () => HAPPENING_MERGE_REFUSAL.outsideCluster,
      'merge-outside-cluster',
    ],
    [
      'a happening merge absorbing one the close wrote',
      () => HAPPENING_MERGE_REFUSAL.closeWrote,
      'merge-close-wrote',
    ],
    [
      'a happening merge among several the close wrote',
      () => HAPPENING_MERGE_REFUSAL.closeWroteNoKeep,
      'merge-close-wrote-no-keep',
    ],
    ['a pin lowered on a frequent row', () => FREQUENT_PIN_LOWERED, 'frequent-pin-lowered'],
    ['a pin raised past the step', () => PIN_RAISE_TOO_LARGE, 'pin-raise-too-large'],
    ['a pin the start never showed', () => NO_START_PIN, 'no-start-pin'],
  ])('records %s as its key', (_label, reason, key) => {
    const warn = vi.spyOn(logger, 'warn')
    expect(ledgerReasonKey(reason(), CALL)).toBe(key)
    expect(warn).not.toHaveBeenCalled()
  })
})
