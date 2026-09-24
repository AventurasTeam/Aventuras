import { describe, expect, it } from 'vitest'

import { hasCopy } from '@/lib/i18n/__tests__/locale-keys'
import { makeEntity } from '@/lib/list-modules/__tests__/fixtures'
import { characterDraftFrom, factionDraftFrom, itemDraftFrom, locationDraftFrom } from '@/lib/world'

import {
  entityFieldLabel,
  entityIssueText,
  entityMenuEntries,
  itemPositionHint,
  lastSeenDetail,
  lastSeenText,
  leadDisabledReason,
  relationshipDescription,
  saveRejectionText,
} from './world-copy'

describe('relationshipDescription', () => {
  it('renders the three perspective states, current character first', () => {
    expect(relationshipDescription('sister', 'brother')).toBe('sister · they see you: brother')
    expect(relationshipDescription('mentor', null)).toBe('mentor · their view: not recorded')
    expect(relationshipDescription(' ', 'rival')).toBe(
      'your view: not recorded · they see you: rival',
    )
  })
})

describe('last seen', () => {
  it('reads a span in its tier, just now, or a fallback for an unknown tier', () => {
    expect(lastSeenText({ tier: 'day', count: 2 })).toBe('last seen 2 days ago')
    expect(lastSeenText({ tier: 'hour', count: 1 })).toBe('last seen 1 hour ago')
    expect(lastSeenText({ tier: 'second', count: 0 })).toBe('last seen just now')
    expect(lastSeenText({ tier: 'cycle', count: 3 })).toBe('last seen 3 × cycle ago')
    expect(lastSeenText(null)).toBeNull()
  })

  it('joins the Connections detail from whatever parts are known', () => {
    expect(
      lastSeenDetail({
        location: 'The Iron Tavern',
        position: 47,
        span: { tier: 'day', count: 2 },
      }),
    ).toBe('The Iron Tavern · entry #47 · 2 days ago in-world')
    expect(
      lastSeenDetail({
        location: undefined,
        position: undefined,
        span: { tier: 'second', count: 0 },
      }),
    ).toBe('just now')
  })
})

describe('labels and issues', () => {
  it('has copy for every draft field of every kind', () => {
    const fields = [
      ...Object.keys(characterDraftFrom(null, [])).map((f) => ['character', f] as const),
      ...Object.keys(locationDraftFrom(null)).map((f) => ['location', f] as const),
      ...Object.keys(itemDraftFrom(null)).map((f) => ['item', f] as const),
      ...Object.keys(factionDraftFrom(null)).map((f) => ['faction', f] as const),
    ]
    for (const [kind, field] of fields) expect(entityFieldLabel(kind, field)).not.toBe(field)
    expect(hasCopy('world:fields.visual.distinguishing')).toBe(true)
  })

  it('names the tab a link-row or quantity issue lives on', () => {
    expect(entityIssueText('relationshipPovRequired')).toBe(
      'Connections: Fill in at least one view.',
    )
    expect(entityIssueText('duplicateStackable')).toBe('Carrying: This quantity is already listed.')
    expect(entityIssueText('nameRequired')).toBe('A name is required.')
  })

  it('maps refusal codes to user copy', () => {
    expect(saveRejectionText('parent-cycle')).toBe(
      'That parent would make this location part of itself.',
    )
    expect(saveRejectionText('in-flight')).toBe(
      "Couldn't save while generation is in flight. Your changes are still here.",
    )
    expect(saveRejectionText(undefined)).toBe(
      "Couldn't save your changes. They're still here — try again.",
    )
  })
})

describe('overflow menu', () => {
  it('offers Set as lead only on characters, with export and delete disabled with reasons', () => {
    const character = entityMenuEntries('character', {
      onViewJson: () => {},
      lead: { onSetLead: () => {} },
    })
    expect(character.map((e) => [e.key, e.disabled ?? false, e.disabledReason])).toEqual([
      ['lead', false, undefined],
      ['export', true, 'Lands in Slice 4.6'],
      ['json', false, undefined],
      ['delete', true, 'Lands in Slice 4.2b'],
    ])
    expect(
      entityMenuEntries('location', { onViewJson: () => {}, lead: { onSetLead: () => {} } }).map(
        (e) => e.key,
      ),
    ).toEqual(['export', 'json', 'delete'])
  })

  it('disables Set as lead on the current lead and on a non-active character', () => {
    const kael = makeEntity({ id: 'char_kael', kind: 'character', name: 'Kael' })
    expect(leadDisabledReason(kael, 'char_kael', false)).toBe('Already the lead')
    expect(leadDisabledReason({ ...kael, status: 'staged' }, null, false)).toBe(
      'Only an active character can be the lead',
    )
    expect(leadDisabledReason(kael, null, true, 'blocked')).toBe('blocked')
    expect(leadDisabledReason(kael, null, false)).toBeUndefined()
  })
})

describe('itemPositionHint', () => {
  it('says who holds an item, else where it lies', () => {
    const keep = makeEntity({ id: 'loc_keep', kind: 'location', name: 'The River Keep' })
    const key = makeEntity({
      id: 'item_key',
      kind: 'item',
      name: 'Old key',
      state: { at_location_id: 'loc_keep' },
    })
    const kael = makeEntity({
      id: 'char_kael',
      kind: 'character',
      name: 'Kael',
      state: {
        visual: {},
        traits: [],
        drives: [],
        current_location_id: null,
        equipped_items: [],
        inventory: ['item_key'],
        faction_id: null,
        lastSeenAt: null,
      },
    })
    expect(itemPositionHint(key, [keep, key], null)).toBe('at The River Keep')
    expect(itemPositionHint(key, [keep, key, kael], null)).toBe('held by Kael')
    expect(itemPositionHint(key, [keep, key, kael], 'char_kael')).toBe('at The River Keep')
  })
})
