import { describe, expect, it } from 'vitest'

import { diffProse, type ProseContext, type ProseTarget } from './diff-prose'
import type { DiffCacheEntry } from './diff-walk'
import type { DiffTable } from './prose-fields'

const entryOf = (
  old: Record<string, unknown>,
  next: Record<string, unknown>,
  names: Record<string, string> = {},
): DiffCacheEntry => ({ old, new: next, names })

type Lookups = Pick<ProseContext, 'liveName' | 'entryLabel' | 'onMistyped'>

const NO_LOOKUPS: Lookups = { liveName: () => null, entryLabel: () => null, onMistyped: () => {} }

const contextOf = (
  table: Exclude<DiffTable, 'character_relationships'>,
  over: Partial<Lookups> = {},
): ProseContext => ({ table, side: null, ...NO_LOOKUPS, ...over })

const relationshipContext = (side: 'a' | 'b'): ProseContext => ({
  table: 'character_relationships',
  side,
  ...NO_LOOKUPS,
})

const ENTITIES = contextOf('entities')

// A character's whole state after the change: the walk picks the `state` column whole.
const KAEL_STATE = {
  visual: { hair: 'black' },
  traits: ['brave', 'former soldier'],
  drives: ['find the crown'],
  voice: 'gravelly',
  current_location_id: null,
  equipped_items: [],
  inventory: [],
  faction_id: null,
  lastSeenAt: null,
}

// A high surrogate with no low one after it, or a low one with no high one before it.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

describe('diffProse — shape', () => {
  it('reads the paths of old, not new: a voice-only payload names only the voice', () => {
    expect(diffProse(entryOf({ state: { voice: 'low' } }, { state: KAEL_STATE }), ENTITIES)).toBe(
      'Voice: "low" → "gravelly"',
    )
  })

  it('labels a visual sub-field by its own label', () => {
    expect(
      diffProse(entryOf({ state: { visual: { hair: 'brown' } } }, { state: KAEL_STATE }), ENTITIES),
    ).toBe('Hair: "brown" → "black"')
  })

  it("joins clauses with '; ' in the payload's order", () => {
    expect(
      diffProse(
        entryOf(
          { description: 'A wary ranger.', state: { voice: 'low' } },
          {
            description: 'A wary ranger. He once served the crown before the war.',
            state: KAEL_STATE,
          },
        ),
        ENTITIES,
      ),
    ).toBe(
      'Description: "A wary ranger." → "A wary ranger. He once served the crown…"; Voice: "low" → "gravelly"',
    )
  })

  it("reads a relationship's kind by the tab's side", () => {
    const entry = entryOf({ kind: 'rival' }, { kind: 'ally' })
    expect(diffProse(entry, relationshipContext('a'))).toBe('Your view: "rival" → "ally"')
    expect(diffProse(entry, relationshipContext('b'))).toBe('Their view: "rival" → "ally"')
  })

  it("reads a relationship's inverseKind as the other view", () => {
    const entry = entryOf({ inverseKind: 'wary' }, { inverseKind: 'fond' })
    expect(diffProse(entry, relationshipContext('a'))).toBe('Their view: "wary" → "fond"')
    expect(diffProse(entry, relationshipContext('b'))).toBe('Your view: "wary" → "fond"')
  })

  it('types a relationship target as naming its side, and no other target as having one', () => {
    // @ts-expect-error a relationship's labels depend on the tab's side
    const sideless: ProseTarget = { table: 'character_relationships', side: null }
    // @ts-expect-error only a relationship row has sides
    const sided: ProseTarget = { table: 'entities', side: 'a' }
    expect([sideless.side, sided.side]).toStrictEqual([null, 'a'])
  })
})

describe('diffProse — equality', () => {
  it('renders no clause for a path whose sides are equal', () => {
    expect(
      diffProse(
        entryOf(
          { name: 'Kael', description: 'a knight' },
          { name: 'Kael', description: 'a wandering knight' },
        ),
        ENTITIES,
      ),
    ).toBe('Description: "a knight" → "a wandering knight"')
  })

  it('returns null when no clause renders', () => {
    expect(diffProse(entryOf({ name: 'Kael' }, { name: 'Kael' }), ENTITIES)).toBeNull()
  })

  it("treats null, absent and '' as one empty value", () => {
    const happenings = contextOf('happenings')
    expect(diffProse(entryOf({ category: '' }, { category: null }), happenings)).toBeNull()
    expect(diffProse(entryOf({ category: null }, {}), happenings)).toBeNull()
    expect(
      diffProse(entryOf({ state: { voice: null } }, { state: { traits: [] } }), ENTITIES),
    ).toBeNull()
  })

  it('compares free text with its whitespace collapsed', () => {
    expect(
      diffProse(
        entryOf({ description: 'A wary\n\n  ranger.' }, { description: 'A wary ranger.' }),
        ENTITIES,
      ),
    ).toBeNull()
  })
})

describe('diffProse — free text', () => {
  it('reads an empty side as none, unquoted', () => {
    expect(diffProse(entryOf({ state: { voice: null } }, { state: KAEL_STATE }), ENTITIES)).toBe(
      'Voice: none → "gravelly"',
    )
    expect(
      diffProse(entryOf({ category: 'omen' }, { category: null }), contextOf('happenings')),
    ).toBe('Category: "omen" → none')
  })

  it('keeps free text reading "none" quoted, apart from an empty side', () => {
    expect(
      diffProse(entryOf({ category: 'none' }, { category: null }), contextOf('happenings')),
    ).toBe('Category: "none" → none')
  })

  it("reads a thread's icon and a happening's time as free text", () => {
    expect(diffProse(entryOf({ icon: 'flame' }, { icon: 'skull' }), contextOf('threads'))).toBe(
      'Icon: "flame" → "skull"',
    )
    expect(
      diffProse(
        entryOf({ temporal: 'at dawn' }, { temporal: 'before dusk' }),
        contextOf('happenings'),
      ),
    ).toBe('Time: "at dawn" → "before dusk"')
  })
})

describe('diffProse — long text', () => {
  it('cuts both sides from one word start before the first difference', () => {
    expect(
      diffProse(
        entryOf(
          {
            description:
              'A wary ranger from the northern marches who served the crown for a decade before the war.',
          },
          {
            description:
              'A wary ranger from the northern marches who deserted the crown after a decade before the war.',
          },
        ),
        ENTITIES,
      ),
    ).toBe(
      'Description: "…marches who served the crown for a…" → "…marches who deserted the crown after a…"',
    )
  })

  it('shows a short side whole and cuts the long side at a space', () => {
    expect(
      diffProse(
        entryOf(
          { description: 'A wary ranger.' },
          { description: 'A wary ranger. He once served the crown before the war.' },
        ),
        ENTITIES,
      ),
    ).toBe('Description: "A wary ranger." → "A wary ranger. He once served the crown…"')
  })

  it('cuts by code point, so an emoji across the 40th UTF-16 unit stays whole', () => {
    const old = `${'a'.repeat(39)}😀${'b'.repeat(20)}`
    expect(Array.from(old)).toHaveLength(60)
    const prose = diffProse(entryOf({ description: old }, { description: 'x' }), ENTITIES)
    expect(prose).toBe(`Description: "${'a'.repeat(39)}😀…" → "x"`)
    expect(prose).not.toMatch(LONE_SURROGATE)
  })

  it('ends a run with no spaces at the 40th character', () => {
    expect(
      diffProse(
        entryOf({ description: 'w'.repeat(200) }, { description: 'v'.repeat(200) }),
        ENTITIES,
      ),
    ).toBe(`Description: "${'w'.repeat(40)}…" → "${'v'.repeat(40)}…"`)
  })

  it('shows two sides of exactly 40 characters whole', () => {
    expect(
      diffProse(
        entryOf({ description: `${'a'.repeat(39)}b` }, { description: `${'a'.repeat(39)}c` }),
        ENTITIES,
      ),
    ).toBe(
      'Description: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab" → "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaac"',
    )
  })

  it('starts at a word start at the difference itself', () => {
    expect(
      diffProse(
        entryOf(
          { description: `${'a'.repeat(30)} served the crown for a decade before the war` },
          { description: `${'a'.repeat(30)} deserted the crown after a decade before the war` },
        ),
        ENTITIES,
      ),
    ).toBe(
      'Description: "…served the crown for a decade before the…" → "…deserted the crown after a decade before…"',
    )
  })

  // Indices: a 0-19, space 20, b 21-36, the difference at 37; 21 is the only word start in 21-37.
  it('starts at a word start exactly 16 characters before the difference', () => {
    expect(
      diffProse(
        entryOf(
          { description: `${'a'.repeat(20)} ${'b'.repeat(16)}cddd` },
          { description: `${'a'.repeat(20)} ${'b'.repeat(16)}eddd` },
        ),
        ENTITIES,
      ),
    ).toBe('Description: "…bbbbbbbbbbbbbbbbcddd" → "…bbbbbbbbbbbbbbbbeddd"')
  })

  // Indices: a 0-18, space 19, b 20-25, space 26, c 27-36, the difference at 37.
  it('passes over a word start 17 characters before the difference', () => {
    expect(
      diffProse(
        entryOf(
          { description: `${'a'.repeat(19)} ${'b'.repeat(6)} ${'c'.repeat(10)}xddd` },
          { description: `${'a'.repeat(19)} ${'b'.repeat(6)} ${'c'.repeat(10)}yddd` },
        ),
        ENTITIES,
      ),
    ).toBe('Description: "…ccccccccccxddd" → "…ccccccccccyddd"')
  })

  // The difference at 30 with no word start in 14-30: both start at 14 and end at the 40th, 53.
  it('starts 16 characters before the difference when that range holds no word start', () => {
    expect(
      diffProse(
        entryOf(
          { description: `${'w'.repeat(30)}x${'w'.repeat(29)}` },
          { description: `${'w'.repeat(30)}y${'w'.repeat(29)}` },
        ),
        ENTITIES,
      ),
    ).toBe(
      `Description: "…${'w'.repeat(16)}x${'w'.repeat(23)}…" → "…${'w'.repeat(16)}y${'w'.repeat(23)}…"`,
    )
  })

  it('ends at a space exactly 40 characters from the start', () => {
    expect(
      diffProse(
        entryOf(
          { description: `${'a'.repeat(20)} ${'b'.repeat(19)} ${'c'.repeat(20)}` },
          { description: 'z' },
        ),
        ENTITIES,
      ),
    ).toBe('Description: "aaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbb…" → "z"')
  })

  it('never ends at a space at the difference itself', () => {
    expect(
      diffProse(
        entryOf(
          { description: `${'x'.repeat(10)} ${'y'.repeat(50)}` },
          { description: `${'x'.repeat(10)}z${'y'.repeat(50)}` },
        ),
        ENTITIES,
      ),
    ).toBe(
      'Description: "xxxxxxxxxx yyyyyyyyyyyyyyyyyyyyyyyyyyyyy…" → "xxxxxxxxxxzyyyyyyyyyyyyyyyyyyyyyyyyyyyyy…"',
    )
  })
})

describe('diffProse — enums, numbers, flags', () => {
  it("reads an entity status in the select's words", () => {
    expect(diffProse(entryOf({ status: 'active' }, { status: 'retired' }), ENTITIES)).toBe(
      'Status: Active → Retired',
    )
  })

  it("reads a thread status in Plot's words", () => {
    expect(
      diffProse(entryOf({ status: 'pending' }, { status: 'active' }), contextOf('threads')),
    ).toBe('Status: Pending → Active')
  })

  it('reads injection modes on entities, lore and threads', () => {
    const auto = entryOf({ injectionMode: 'auto' }, { injectionMode: 'always' })
    expect(diffProse(auto, ENTITIES)).toBe('Injection: Auto → Always')
    expect(diffProse(auto, contextOf('lore'))).toBe('Injection: Auto → Always')
    expect(
      diffProse(
        entryOf({ injectionMode: 'always' }, { injectionMode: 'disabled' }),
        contextOf('threads'),
      ),
    ).toBe('Injection: Always → Disabled')
  })

  it('reads numbers as stored', () => {
    expect(diffProse(entryOf({ priority: 0 }, { priority: 5 }), contextOf('lore'))).toBe(
      'Priority: 0 → 5',
    )
    expect(
      diffProse(
        entryOf({ decayResistance: 0.5 }, { decayResistance: 0.8 }),
        contextOf('happening_awareness'),
      ),
    ).toBe('Decay resistance: 0.5 → 0.8')
    expect(
      diffProse(
        entryOf({ decayResistance: null }, { decayResistance: 0.8 }),
        contextOf('happening_awareness'),
      ),
    ).toBe('Decay resistance: none → 0.8')
  })

  it('reads a 0/1 flag as no and yes', () => {
    const happenings = contextOf('happenings')
    expect(diffProse(entryOf({ commonKnowledge: 0 }, { commonKnowledge: 1 }), happenings)).toBe(
      'Common knowledge: no → yes',
    )
    expect(diffProse(entryOf({ commonKnowledge: 1 }, { commonKnowledge: 0 }), happenings)).toBe(
      'Common knowledge: yes → no',
    )
  })

  it('reads a boolean-mode flag the same way', () => {
    expect(
      diffProse(
        entryOf({ commonKnowledge: false }, { commonKnowledge: true }),
        contextOf('happenings'),
      ),
    ).toBe('Common knowledge: no → yes')
  })

  it('renders nothing for an enum, number or flag whose value is unchanged', () => {
    expect(diffProse(entryOf({ status: 'active' }, { status: 'active' }), ENTITIES)).toBeNull()
    expect(diffProse(entryOf({ priority: 3 }, { priority: 3 }), contextOf('lore'))).toBeNull()
    expect(
      diffProse(
        entryOf({ commonKnowledge: 0 }, { commonKnowledge: false }),
        contextOf('happenings'),
      ),
    ).toBeNull()
  })
})

describe('diffProse — no wording falls back to the field-name summary', () => {
  it('returns null for a payload of only $ keys', () => {
    expect(
      diffProse(entryOf({ $resolvedPair: 'char_mira' }, { name: 'Kael' }), ENTITIES),
    ).toBeNull()
  })

  it('returns null for a path with no wording, even beside a worded change', () => {
    expect(diffProse(entryOf({ bogus: 'x' }, { bogus: 'y' }), ENTITIES)).toBeNull()
    expect(
      diffProse(entryOf({ name: 'Kael', bogus: 'x' }, { name: 'Ser Kael', bogus: 'y' }), ENTITIES),
    ).toBeNull()
  })

  it('returns null for a state column whose old value was null', () => {
    expect(diffProse(entryOf({ state: null }, { state: KAEL_STATE }), ENTITIES)).toBeNull()
  })

  it('returns null for a value no wording covers', () => {
    expect(diffProse(entryOf({ status: 'bogus' }, { status: 'active' }), ENTITIES)).toBeNull()
    expect(diffProse(entryOf({ name: 7 }, { name: 'Kael' }), ENTITIES)).toBeNull()
  })
})

describe('diffProse — a value of the wrong type', () => {
  function reporting(table: Exclude<DiffTable, 'character_relationships'>) {
    const reported: string[] = []
    return { reported, context: contextOf(table, { onMistyped: (path) => reported.push(path) }) }
  }

  it('returns null and reports its path, though a clause beside it renders', () => {
    const { reported, context } = reporting('entities')
    expect(
      diffProse(
        entryOf({ description: 'old', name: 'Kael' }, { description: 'new', name: 7 }),
        context,
      ),
    ).toBeNull()
    expect(reported).toEqual(['name'])
  })

  it('reports it past a path with no wording', () => {
    const { reported, context } = reporting('entities')
    expect(
      diffProse(entryOf({ bogus: 'x', name: 'Kael' }, { bogus: 'y', name: 7 }), context),
    ).toBeNull()
    expect(reported).toEqual(['name'])
  })

  it('reports nothing for a path with no wording, nor for prose that renders', () => {
    const { reported, context } = reporting('entities')
    expect(diffProse(entryOf({ bogus: 'x' }, { bogus: 'y' }), context)).toBeNull()
    expect(diffProse(entryOf({ state: null }, { state: KAEL_STATE }), context)).toBeNull()
    expect(diffProse(entryOf({ description: 'old' }, { description: 'new' }), context)).toBe(
      'Description: "old" → "new"',
    )
    expect(reported).toEqual([])
  })

  // One wrong-typed new value per field kind.
  it.each<[Exclude<DiffTable, 'character_relationships'>, Record<string, unknown>, string]>([
    ['entities', { name: 7 }, 'name'],
    ['entities', { status: 'bogus' }, 'status'],
    ['lore', { priority: 'high' }, 'priority'],
    ['happenings', { commonKnowledge: 2 }, 'commonKnowledge'],
    ['entities', { tags: 'brave' }, 'tags'],
    ['entities', { state: { stackables: { gold: 'many' } } }, 'state.stackables'],
    ['entities', { state: { stackables: 7 } }, 'state.stackables'],
    ['entities', { state: { faction_id: 7 } }, 'state.faction_id'],
    ['entities', { state: { inventory: [7] } }, 'state.inventory'],
    ['happenings', { occurredAtEntryId: 7 }, 'occurredAtEntryId'],
    ['entities', { state: { lastSeenAt: 'yesterday' } }, 'state.lastSeenAt'],
    ['entities', { state: { parent_location_id: 7 } }, 'state.parent_location_id'],
    ['entities', { nameCollisionFlag: 'yes' }, 'nameCollisionFlag'],
  ])('reports %s %j at %s', (table, next, path) => {
    const { reported, context } = reporting(table)
    const old = path.startsWith('state.')
      ? { state: { [path.slice('state.'.length)]: null } }
      : { [path]: null }
    expect(diffProse(entryOf(old, next), context)).toBeNull()
    expect(reported).toEqual([path])
  })

  it('reports a wrong-typed old value', () => {
    const { reported, context } = reporting('entities')
    expect(diffProse(entryOf({ name: 7 }, { name: 'Kael' }), context)).toBeNull()
    expect(
      diffProse(
        entryOf({ state: { stackables: 'lots' } }, { state: { stackables: { gold: 1 } } }),
        context,
      ),
    ).toBeNull()
    expect(reported).toEqual(['name', 'state.stackables'])
  })
})

describe('diffProse — term lists', () => {
  it("names only the list in old's keys: canon's iteration-rule example", () => {
    expect(
      diffProse(entryOf({ state: { traits: ['brave'] } }, { state: KAEL_STATE }), ENTITIES),
    ).toBe('Traits: added "former soldier"')
  })

  it("reads canon's change-prose example whole", () => {
    expect(
      diffProse(
        entryOf(
          { description: 'A wary ranger.', state: { traits: ['brave'], voice: 'low' } },
          {
            description: 'A wary ranger. He once served the crown before the war.',
            state: KAEL_STATE,
          },
        ),
        ENTITIES,
      ),
    ).toBe(
      'Description: "A wary ranger." → "A wary ranger. He once served the crown…"; Traits: added "former soldier"; Voice: "low" → "gravelly"',
    )
  })

  it("reads added in the new list's order, then removed in the old list's order", () => {
    expect(
      diffProse(
        entryOf(
          { state: { traits: ['loyal', 'brave'] } },
          { state: { ...KAEL_STATE, traits: ['brave', 'former soldier', 'scarred'] } },
        ),
        ENTITIES,
      ),
    ).toBe('Traits: added "former soldier", "scarred", removed "loyal"')
  })

  it("reads several removed terms in the old list's order", () => {
    expect(
      diffProse(
        entryOf(
          { state: { traits: ['proud', 'loyal', 'brave'] } },
          { state: { ...KAEL_STATE, traits: ['brave'] } },
        ),
        ENTITIES,
      ),
    ).toBe('Traits: removed "proud", "loyal"')
  })

  it("respells normalized tags in the new list's order", () => {
    expect(
      diffProse(
        entryOf({ tags: ['eldra', 'iron pact'] }, { tags: ['Iron Pact', 'Eldra'] }),
        contextOf('lore'),
      ),
    ).toBe('Tags: respelled "iron pact" as "Iron Pact", "eldra" as "Eldra"')
  })

  it('matches a state list exactly: a case change is an add and a remove', () => {
    expect(
      diffProse(
        entryOf(
          { state: { drives: ['Find the crown'] } },
          { state: { ...KAEL_STATE, drives: ['find the crown'] } },
        ),
        ENTITIES,
      ),
    ).toBe('Drives: added "find the crown", removed "Find the crown"')
  })

  it('renders nothing for a reorder alone', () => {
    expect(
      diffProse(
        entryOf(
          { state: { traits: ['former soldier', 'brave'] } },
          { state: { ...KAEL_STATE, traits: ['brave', 'former soldier'] } },
        ),
        ENTITIES,
      ),
    ).toBeNull()
  })

  it('names a duplicated term once', () => {
    expect(
      diffProse(
        entryOf(
          { state: { traits: ['brave'] } },
          { state: { ...KAEL_STATE, traits: ['brave', 'scarred', 'scarred'] } },
        ),
        ENTITIES,
      ),
    ).toBe('Traits: added "scarred"')
  })

  it('spells a duplicated normalized term as its first occurrence', () => {
    expect(diffProse(entryOf({ tags: [] }, { tags: ['Eldra', 'eldra'] }), contextOf('lore'))).toBe(
      'Tags: added "Eldra"',
    )
  })

  it('cuts a term over 40 characters at a word end, and shows one of 40 whole', () => {
    expect(
      diffProse(
        entryOf(
          { state: { traits: ['brave'] } },
          {
            state: {
              ...KAEL_STATE,
              traits: [
                'brave',
                'the oath sworn beneath the broken keep at midnight',
                'an unbroken oath sworn beneath the keeps',
              ],
            },
          },
        ),
        ENTITIES,
      ),
    ).toBe(
      'Traits: added "the oath sworn beneath the broken keep…", "an unbroken oath sworn beneath the keeps"',
    )
  })

  it('reads respelled after removed', () => {
    expect(
      diffProse(entryOf({ tags: ['eldra', 'old oath'] }, { tags: ['Eldra'] }), contextOf('lore')),
    ).toBe('Tags: removed "old oath", respelled "eldra" as "Eldra"')
  })

  it("collapses a term's whitespace before cutting it", () => {
    expect(
      diffProse(
        entryOf(
          { state: { traits: ['brave'] } },
          {
            state: {
              ...KAEL_STATE,
              traits: ['brave', 'the oath  sworn\nbeneath the broken keep at midnight'],
            },
          },
        ),
        ENTITIES,
      ),
    ).toBe('Traits: added "the oath sworn beneath the broken keep…"')
  })

  it('shows whole a term that collapses to 40 characters, though longer as stored', () => {
    expect(
      diffProse(
        entryOf(
          { state: { traits: ['brave'] } },
          {
            state: {
              ...KAEL_STATE,
              traits: ['brave', 'an  unbroken  oath  sworn  beneath  the  keeps'],
            },
          },
        ),
        ENTITIES,
      ),
    ).toBe('Traits: added "an unbroken oath sworn beneath the keeps"')
  })

  it('cuts a 50-character term with no space at the 40th character', () => {
    expect(
      diffProse(
        entryOf(
          { state: { traits: ['brave'] } },
          {
            state: {
              ...KAEL_STATE,
              traits: ['brave', 'abcdefghijabcdefghijabcdefghijabcdefghijabcdefghij'],
            },
          },
        ),
        ENTITIES,
      ),
    ).toBe('Traits: added "abcdefghijabcdefghijabcdefghijabcdefghij…"')
  })

  it('keeps the word that ends exactly at the 40th character', () => {
    expect(
      diffProse(
        entryOf(
          { state: { traits: ['brave'] } },
          {
            state: {
              ...KAEL_STATE,
              traits: ['brave', 'an unbroken oath sworn beneath the keeps forever'],
            },
          },
        ),
        ENTITIES,
      ),
    ).toBe('Traits: added "an unbroken oath sworn beneath the keeps…"')
  })

  it('cuts a term by code point, never inside a surrogate pair', () => {
    const shown = diffProse(
      entryOf(
        { state: { traits: ['brave'] } },
        {
          state: {
            ...KAEL_STATE,
            traits: ['brave', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa😀bbbbbbbbbb'],
          },
        },
      ),
      ENTITIES,
    )
    expect(shown).toBe('Traits: added "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa😀…"')
    expect(shown).not.toMatch(LONE_SURROGATE)
  })

  it('reads an agenda absent before as an empty list', () => {
    expect(
      diffProse(
        entryOf(
          { state: { agenda: null } },
          { state: { standing: 'feared', agenda: ['take the pass'] } },
        ),
        ENTITIES,
      ),
    ).toBe('Agenda: added "take the pass"')
  })
})

describe('diffProse — quantities', () => {
  it("reads each of the old partial's keys, none for a key a side lacks", () => {
    expect(
      diffProse(
        entryOf(
          { state: { stackables: { gold: 250, arrows: null } } },
          { state: { ...KAEL_STATE, stackables: { gold: 200, arrows: 12 } } },
        ),
        ENTITIES,
      ),
    ).toBe('Quantities: gold 250 → 200, arrows none → 12')
  })

  it('reads every key of the new record as an addition when the old was null', () => {
    expect(
      diffProse(
        entryOf(
          { state: { stackables: null } },
          { state: { ...KAEL_STATE, stackables: { gold: 5, rope: 1 } } },
        ),
        ENTITIES,
      ),
    ).toBe('Quantities: gold none → 5, rope none → 1')
  })

  it('reads a removed key as none', () => {
    expect(
      diffProse(
        entryOf(
          { state: { stackables: { torches: 3 } } },
          { state: { ...KAEL_STATE, stackables: {} } },
        ),
        ENTITIES,
      ),
    ).toBe('Quantities: torches 3 → none')
  })

  it('renders nothing for a key whose counts match', () => {
    expect(
      diffProse(
        entryOf(
          { state: { stackables: { gold: 5 } } },
          { state: { ...KAEL_STATE, stackables: { gold: 5 } } },
        ),
        ENTITIES,
      ),
    ).toBeNull()
  })
})

const lookup =
  (map: Readonly<Record<string, string>>) =>
  (id: string): string | null =>
    Object.hasOwn(map, id) ? map[id] : null

const WORLD = contextOf('entities', {
  liveName: lookup({
    fac_iron: 'Iron Pact',
    item_coin: 'Silver coin',
    loc_tavern: 'The Tavern',
    loc_market: 'Market Square',
    loc_quarter: 'The Old Quarter',
    char_kael: 'Kael',
  }),
  entryLabel: lookup({ ent_3: 'entry #3', ent_40: 'entry #40', ent_47: 'entry #47' }),
})

const ENTRY_LABELS = lookup({ ent_12: 'entry #12', ent_31: 'entry #31' })

describe('diffProse — refs', () => {
  it("names a row ref's row, none for a null side", () => {
    expect(
      diffProse(
        entryOf(
          { state: { faction_id: null } },
          { state: { ...KAEL_STATE, faction_id: 'fac_iron' } },
        ),
        WORLD,
      ),
    ).toBe('Faction: none → Iron Pact')
  })

  it('marks a ref the working set lacks (deleted), under its walk-time name', () => {
    expect(
      diffProse(
        entryOf(
          { state: { faction_id: 'fac_iron_old' } },
          { state: { ...KAEL_STATE, faction_id: 'fac_iron' } },
          { fac_iron_old: 'Iron Pact' },
        ),
        WORLD,
      ),
    ).toBe('Faction: Iron Pact (deleted) → Iron Pact')
  })

  it('takes the live name over the walk-time one', () => {
    expect(
      diffProse(
        entryOf(
          { state: { faction_id: null } },
          { state: { ...KAEL_STATE, faction_id: 'fac_iron' } },
          { fac_iron: 'The Old Pact' },
        ),
        WORLD,
      ),
    ).toBe('Faction: none → Iron Pact')
  })

  it('reads Unknown row for a ref with no live name and no walk-time name', () => {
    expect(
      diffProse(
        entryOf(
          { state: { faction_id: null } },
          { state: { ...KAEL_STATE, faction_id: 'fac_lost' } },
        ),
        WORLD,
      ),
    ).toBe('Faction: none → Unknown row')
  })

  it('reads a ref list as a term list, with names in place of quoted terms', () => {
    expect(
      diffProse(
        entryOf(
          { state: { inventory: ['item_rope'] } },
          { state: { ...KAEL_STATE, inventory: ['item_coin'] } },
          { item_rope: 'Rope' },
        ),
        WORLD,
      ),
    ).toBe('Carried: added Silver coin, removed Rope (deleted)')
  })

  it('matches ref ids exactly, not by normalized term', () => {
    expect(
      diffProse(
        entryOf(
          { state: { inventory: ['item_Rope'] } },
          { state: { ...KAEL_STATE, inventory: ['item_rope'] } },
          { item_Rope: 'Rope', item_rope: 'Rope' },
        ),
        WORLD,
      ),
    ).toBe('Carried: added Rope (deleted), removed Rope (deleted)')
  })
})

describe('diffProse — entry refs', () => {
  it('reads an entry ref as the meta line does, none for a null side', () => {
    expect(
      diffProse(
        entryOf({ resolvedAtEntryId: null }, { resolvedAtEntryId: 'ent_31' }),
        contextOf('threads', { entryLabel: ENTRY_LABELS }),
      ),
    ).toBe('Resolved at: none → entry #31')
  })

  it("reads Unknown entry for an entry the branch's index doesn't hold", () => {
    expect(
      diffProse(
        entryOf({ occurredAtEntryId: 'ent_gone' }, { occurredAtEntryId: 'ent_12' }),
        contextOf('happenings', { entryLabel: ENTRY_LABELS }),
      ),
    ).toBe('Occurred at: Unknown entry → entry #12')
  })
})

describe('diffProse — last seen', () => {
  it('reads its entry and its place', () => {
    expect(
      diffProse(
        entryOf(
          { state: { lastSeenAt: { entryId: 'ent_40', locationId: 'loc_tavern', worldTime: 10 } } },
          {
            state: {
              ...KAEL_STATE,
              lastSeenAt: { entryId: 'ent_47', locationId: 'loc_market', worldTime: 20 },
            },
          },
        ),
        WORLD,
      ),
    ).toBe('Last seen: entry #40 at The Tavern → entry #47 at Market Square')
  })

  it('reads none for a null side and the entry alone with no place', () => {
    expect(
      diffProse(
        entryOf(
          { state: { lastSeenAt: null } },
          {
            state: {
              ...KAEL_STATE,
              lastSeenAt: { entryId: 'ent_3', locationId: null, worldTime: 1 },
            },
          },
        ),
        WORLD,
      ),
    ).toBe('Last seen: none → entry #3')
  })

  it('reads a change of place alone', () => {
    expect(
      diffProse(
        entryOf(
          { state: { lastSeenAt: { entryId: 'ent_40', locationId: 'loc_tavern', worldTime: 10 } } },
          {
            state: {
              ...KAEL_STATE,
              lastSeenAt: { entryId: 'ent_40', locationId: 'loc_market', worldTime: 10 },
            },
          },
        ),
        WORLD,
      ),
    ).toBe('Last seen: entry #40 at The Tavern → entry #40 at Market Square')
  })

  it('takes the keys a partial old lacks from new', () => {
    expect(
      diffProse(
        entryOf(
          { state: { lastSeenAt: { entryId: 'ent_40' } } },
          {
            state: {
              ...KAEL_STATE,
              lastSeenAt: { entryId: 'ent_47', locationId: 'loc_tavern', worldTime: 9 },
            },
          },
        ),
        WORLD,
      ),
    ).toBe('Last seen: entry #40 at The Tavern → entry #47 at The Tavern')
  })

  it('renders nothing for a change to world time alone', () => {
    expect(
      diffProse(
        entryOf(
          { state: { lastSeenAt: { worldTime: 5 } } },
          {
            state: {
              ...KAEL_STATE,
              lastSeenAt: { entryId: 'ent_40', locationId: 'loc_tavern', worldTime: 9 },
            },
          },
        ),
        WORLD,
      ),
    ).toBeNull()
  })
})

describe('diffProse — the placement group', () => {
  it('reads an unplaced place as Unknown, in one clause for both paths', () => {
    expect(
      diffProse(
        entryOf(
          { state: { parent_location_id: null, unplaced: true } },
          { state: { parent_location_id: 'loc_quarter' } },
        ),
        WORLD,
      ),
    ).toBe('Parent location: Unknown → The Old Quarter')
  })

  it('reads a null parent that is not unplaced as Top level', () => {
    expect(
      diffProse(
        entryOf(
          { state: { parent_location_id: 'loc_quarter' } },
          { state: { parent_location_id: null } },
        ),
        WORLD,
      ),
    ).toBe('Parent location: The Old Quarter → Top level')
  })

  it('reads a false mark as placed, not Unknown', () => {
    expect(
      diffProse(
        entryOf(
          { state: { parent_location_id: 'loc_quarter' } },
          { state: { parent_location_id: null, unplaced: false } },
        ),
        WORLD,
      ),
    ).toBe('Parent location: The Old Quarter → Top level')
  })

  it('takes the mark from new when the payload holds only the parent', () => {
    expect(
      diffProse(
        entryOf(
          { state: { parent_location_id: null } },
          { state: { parent_location_id: null, unplaced: true } },
        ),
        WORLD,
      ),
    ).toBeNull()
  })

  it('takes the parent from new when the payload holds only the mark', () => {
    expect(
      diffProse(
        entryOf(
          { state: { unplaced: null } },
          { state: { parent_location_id: null, unplaced: true } },
        ),
        WORLD,
      ),
    ).toBe('Parent location: Top level → Unknown')
  })
})

describe('diffProse — the collision group', () => {
  it("reads a raised flag as its partner's name, in one clause for three columns", () => {
    expect(
      diffProse(
        entryOf(
          { nameCollisionFlag: 0, nameCollisionPartnerId: null, nameCollisionReason: null },
          {
            nameCollisionFlag: 1,
            nameCollisionPartnerId: 'char_kael',
            nameCollisionReason: 'alike',
          },
        ),
        WORLD,
      ),
    ).toBe('Collision flag: none → Kael')
  })

  it('reads a flag a merge cleared', () => {
    expect(
      diffProse(
        entryOf(
          {
            nameCollisionFlag: 1,
            nameCollisionPartnerId: 'char_kael_old',
            nameCollisionReason: 'duplicate',
          },
          { nameCollisionFlag: 0, nameCollisionPartnerId: null, nameCollisionReason: null },
          { char_kael_old: 'Kael' },
        ),
        WORLD,
      ),
    ).toBe('Collision flag: Kael (deleted) → none')
  })

  it('reads a flag a merge re-pointed, taking the flag from new', () => {
    expect(
      diffProse(
        entryOf(
          { nameCollisionPartnerId: 'char_kael_old' },
          {
            nameCollisionFlag: 1,
            nameCollisionPartnerId: 'char_kael',
            nameCollisionReason: 'duplicate',
          },
          { char_kael_old: 'Kael' },
        ),
        WORLD,
      ),
    ).toBe('Collision flag: Kael (deleted) → Kael')
  })

  it('reads a flag that was lowered as none, whatever partner it still names', () => {
    expect(
      diffProse(
        entryOf(
          { nameCollisionFlag: 0, nameCollisionPartnerId: 'char_kael' },
          {
            nameCollisionFlag: 1,
            nameCollisionPartnerId: 'char_kael',
            nameCollisionReason: 'alike',
          },
        ),
        WORLD,
      ),
    ).toBe('Collision flag: none → Kael')
  })

  it('renders nothing for a change to the reason alone', () => {
    expect(
      diffProse(
        entryOf(
          { nameCollisionReason: 'alike' },
          {
            nameCollisionFlag: 1,
            nameCollisionPartnerId: 'char_kael',
            nameCollisionReason: 'distinct',
          },
        ),
        WORLD,
      ),
    ).toBeNull()
  })
})

describe('diffProse — a value holding placeholder text', () => {
  it('shows an old free text holding {{new}} as written', () => {
    expect(
      diffProse(entryOf({ description: 'use {{new}} here' }, { description: 'plain' }), ENTITIES),
    ).toBe('Description: "use {{new}} here" → "plain"')
  })

  it('shows an old name holding {{new}} as written', () => {
    expect(diffProse(entryOf({ name: 'Kael {{new}}' }, { name: 'Kael' }), ENTITIES)).toBe(
      'Name: "Kael {{new}}" → "Kael"',
    )
  })

  it('shows a quantity named {{change}} as written', () => {
    expect(
      diffProse(
        entryOf(
          { state: { stackables: { '{{change}}': 1 } } },
          { state: { ...KAEL_STATE, stackables: { '{{change}}': 2 } } },
        ),
        ENTITIES,
      ),
    ).toBe('Quantities: {{change}} 1 → 2')
  })

  it('shows a respelled term holding {{new}} as written', () => {
    expect(
      diffProse(entryOf({ tags: ['{{new}} pact'] }, { tags: ['{{New}} Pact'] }), contextOf('lore')),
    ).toBe('Tags: respelled "{{new}} pact" as "{{New}} Pact"')
  })
})
