import { describe, expect, it } from 'vitest'

import { diffProse, type ProseContext } from './diff-prose'
import type { DiffCacheEntry } from './diff-walk'
import type { DiffTable } from './prose-fields'

const entryOf = (
  old: Record<string, unknown>,
  next: Record<string, unknown>,
  names: Record<string, string> = {},
): DiffCacheEntry => ({ old, new: next, names })

const contextOf = (table: DiffTable, over: Partial<ProseContext> = {}): ProseContext => ({
  table,
  side: null,
  liveName: () => null,
  entryLabel: () => null,
  ...over,
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
    expect(diffProse(entry, contextOf('character_relationships', { side: 'a' }))).toBe(
      'Your view: "rival" → "ally"',
    )
    expect(diffProse(entry, contextOf('character_relationships', { side: 'b' }))).toBe(
      'Their view: "rival" → "ally"',
    )
  })

  it("reads a relationship's inverseKind as the other view", () => {
    const entry = entryOf({ inverseKind: 'wary' }, { inverseKind: 'fond' })
    expect(diffProse(entry, contextOf('character_relationships', { side: 'a' }))).toBe(
      'Their view: "wary" → "fond"',
    )
    expect(diffProse(entry, contextOf('character_relationships', { side: 'b' }))).toBe(
      'Your view: "wary" → "fond"',
    )
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
