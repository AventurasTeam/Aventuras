import { describe, expect, it } from 'vitest'

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
  leadRejectionText,
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

  it('reads neither view recorded when both are blank', () => {
    expect(relationshipDescription(null, null)).toBe('no views recorded yet')
    expect(relationshipDescription('', ' ')).toBe('no views recorded yet')
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
  it("labels every draft field of every kind with its own kind's map", () => {
    const fields = [
      ...Object.keys(characterDraftFrom(null, [])).map((f) => ['character', f] as const),
      ...Object.keys(locationDraftFrom(null)).map((f) => ['location', f] as const),
      ...Object.keys(itemDraftFrom(null)).map((f) => ['item', f] as const),
      ...Object.keys(factionDraftFrom(null)).map((f) => ['faction', f] as const),
    ]
    for (const [kind, field] of fields) expect(entityFieldLabel(kind, field)).not.toBe(field)
  })

  it('names the tab a link-row or quantity issue lives on', () => {
    expect(entityIssueText('relationshipPovRequired')).toBe(
      'Connections: Fill in at least one view.',
    )
    expect(entityIssueText('duplicateStackable')).toBe('Carrying: This quantity is already listed.')
    expect(entityIssueText('nameRequired')).toBe('A name is required.')
  })

  it('leaves an unknown message unchanged', () => {
    expect(entityIssueText('Expected number, received nan')).toBe('Expected number, received nan')
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

describe('ISSUE_TAB', () => {
  it('names the tab for every mapped issue', () => {
    expect(entityIssueText('characterRequired')).toBe('Connections: Pick a character.')
    expect(entityIssueText('relationshipPovRequired')).toBe(
      'Connections: Fill in at least one view.',
    )
    expect(entityIssueText('duplicateRelationship')).toBe(
      'Connections: This character already has a relationship here.',
    )
    expect(entityIssueText('parentCycle')).toBe(
      'Connections: That parent would make this location part of itself.',
    )
    expect(entityIssueText('stackableKeyRequired')).toBe('Carrying: Name the quantity.')
    expect(entityIssueText('stackableCount')).toBe('Carrying: Enter a whole number, 0 or more.')
    expect(entityIssueText('duplicateStackable')).toBe('Carrying: This quantity is already listed.')
    expect(entityIssueText('priorityRange')).toBe('Settings: Enter a whole number from 0 to 100.')
  })
})

describe('leadRejectionText', () => {
  it('names generation in flight and an inactive character, otherwise the generic failure', () => {
    expect(leadRejectionText('in-flight')).toBe(
      "Couldn't change the lead while generation is in flight.",
    )
    expect(leadRejectionText('not-active')).toBe('Only an active character can be the lead.')
    expect(leadRejectionText('wrong-branch')).toBe("Couldn't change the lead.")
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

  it('disables the lead entry with its reason, and omits it for non-characters', () => {
    const entries = entityMenuEntries('character', {
      onViewJson: () => {},
      lead: { onSetLead: () => {}, disabledReason: 'Already the lead' },
    })
    const lead = entries.find((e) => e.key === 'lead')
    expect(lead?.disabled).toBe(true)
    expect(lead?.disabledReason).toBe('Already the lead')
    expect(
      entityMenuEntries('faction', { onViewJson: () => {}, lead: { onSetLead: () => {} } }).some(
        (e) => e.key === 'lead',
      ),
    ).toBe(false)
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

  it('falls back to the generation-gate text when blocked with no reason given', () => {
    const kael = makeEntity({ id: 'char_kael', kind: 'character', name: 'Kael' })
    expect(leadDisabledReason(kael, null, true)).toBe('Generation is in flight. Cancel to edit.')
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

  it('reads the missing text alone when the location no longer exists', () => {
    const orphan = makeEntity({
      id: 'item_orphan',
      kind: 'item',
      name: 'Orphan key',
      state: { at_location_id: 'loc_gone' },
    })
    expect(itemPositionHint(orphan, [orphan], null)).toBe('Entity no longer exists')
  })
})
