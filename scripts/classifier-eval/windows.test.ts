import { describe, expect, it } from 'vitest'

import { reply } from './fixture'
import { EVAL_WINDOWS, renderWindow } from './index'

const MAX_ENTRIES = 20

describe.each(EVAL_WINDOWS.map((w) => [w.name, w] as const))('eval window %s', (_, w) => {
  const failing = (kind: 'expect' | 'avoid' | null, r: typeof w.ideal, holds: boolean) =>
    w.checks
      .filter((c) => (kind == null || c.kind === kind) && c.holds(r) === holds)
      .map((c) => c.name)

  it('its ideal reply passes every check', () => {
    expect(failing(null, w.ideal, false)).toEqual([])
  })

  it('an empty reply fails every expect check', () => {
    expect(failing('expect', reply({}), true)).toEqual([])
  })

  it('its bad reply fails every avoid check', () => {
    expect(failing('avoid', w.bad, true)).toEqual([])
  })

  it('flags its lead, or nothing', () => {
    expect(w.entities.filter((e) => e.isLead === 1).map((e) => e.id)).toEqual(
      w.lead == null ? [] : [w.lead],
    )
  })

  it('fails no check on a blank-named new character, which the planner never creates', () => {
    const extra = {
      handle: 'new:extra',
      name: '',
      description: 'x',
      keywords: [],
      sourceTurn: 't1',
    }
    const r = { ...w.ideal, newCharacters: [...w.ideal.newCharacters, extra] }
    expect(failing(null, r, false)).toEqual([])
  })

  it('shows every turn and no fixture id in the prompt', () => {
    const { prompt } = renderWindow(w, MAX_ENTRIES)
    for (const entry of w.entries) expect(prompt.user).toContain(entry.content)
    expect(prompt.user).not.toMatch(/\b(char|fact|loc|hap|thr)_/)
  })

  it('reads its ideal reply, written in placeholders, back as the ideal reply', () => {
    const { legend, schema, read } = renderWindow(w, MAX_ENTRIES)
    const inPlaceholders: unknown = JSON.parse(JSON.stringify(w.ideal), (_key, value: unknown) =>
      typeof value === 'string' ? (legend.get(value) ?? value) : value,
    )
    expect(inPlaceholders).not.toEqual(w.ideal)
    const { reply: back, malformed } = read(schema.parse(inPlaceholders))
    expect(malformed).toEqual([])
    expect(back).toEqual(w.ideal)
  })

  it('reads its ideal reply back with every ID and turn handle in the brackets the prompt shows', () => {
    const { legend, schema, read } = renderWindow(w, MAX_ENTRIES)
    const placeholders = new Set(legend.values())
    const bracketed: unknown = JSON.parse(JSON.stringify(w.ideal), (key, value: unknown) => {
      if (typeof value !== 'string' || key === 'handle') return value
      const id = legend.get(value) ?? value
      return placeholders.has(id) || /^t\d+$/.test(id) || id.startsWith('new:') ? `[${id}]` : id
    })
    expect(JSON.stringify(bracketed)).toContain('"[t')
    const { reply: back } = read(schema.parse(bracketed))
    expect(back).toEqual(w.ideal)
  })
})

// Every window but the switch is written under one lead, or none.
describe.each(EVAL_WINDOWS.filter((w) => w.name !== 'switch').map((w) => [w.name, w] as const))(
  'eval window %s, written under one lead or none',
  (_, w) => {
    it('stamps every turn with its lead, or stamps nothing', () => {
      expect(w.entries.map((e) => e.metadata?.leadId)).toEqual(w.entries.map(() => w.lead))
    })
  },
)

it('the switch window stamps its first two turns with Wenna, its last two with Dace, and flags Dace alone', () => {
  const w = EVAL_WINDOWS.find((x) => x.name === 'switch')!
  expect(w.lead).toBe('char_dace')
  expect(w.entities.filter((e) => e.isLead === 1).map((e) => e.id)).toEqual(['char_dace'])
  expect(w.entries.map((e) => e.metadata?.leadId)).toEqual([
    'char_wenna',
    'char_wenna',
    'char_dace',
    'char_dace',
  ])
})

it('the ambush window leads with Tobin on all four turns; the direction window has no lead', () => {
  const ambush = EVAL_WINDOWS.find((x) => x.name === 'ambush')!
  expect(ambush.entities.filter((e) => e.isLead === 1).map((e) => e.name)).toEqual(['Tobin Ash'])
  expect(ambush.entries.map((e) => e.metadata?.leadId)).toEqual([
    'char_tobin',
    'char_tobin',
    'char_tobin',
    'char_tobin',
  ])
  const direction = EVAL_WINDOWS.find((x) => x.name === 'direction')!
  expect(direction.entities.filter((e) => e.isLead === 1)).toEqual([])
  expect(direction.entries.map((e) => e.metadata?.leadId)).toEqual(
    direction.entries.map(() => undefined),
  )
})

// A relative the prose names after a character is someone else.
describe.each([
  ['learning', 'Tam Rook is a new character', /^tam/i, "Tam Rook's aunt"],
  ['recounted', 'Edric Vane is a new character', /vane/i, 'The son of Count Edric Vane'],
  ['recounted', 'Vane, who gave the order, is involved in the wreck', /vane/i, 'son of Edric Vane'],
] as const)('eval window %s', (window, check, own, relative) => {
  it(`fails "${check}" when only a relative is added`, () => {
    const w = EVAL_WINDOWS.find((x) => x.name === window)!
    const holds = w.checks.find((c) => c.name === check)!.holds
    const target = w.ideal.newCharacters.find((c) => own.test(c.name))!
    const r = {
      ...w.ideal,
      newCharacters: w.ideal.newCharacters.map((c) =>
        c === target ? { ...c, name: relative } : c,
      ),
    }
    expect(holds(w.ideal)).toBe(true)
    expect(holds(r)).toBe(false)
  })
})

// Four replies retired Tam's own new handle, two for "ran the same night".
it('the learning window counts a retirement of Tam as making him dead', () => {
  const w = EVAL_WINDOWS.find((x) => x.name === 'learning')!
  const holds = w.checks.find((c) => c.name === 'Tam Rook, who fled, is not made dead')!.holds
  const tam = w.ideal.newCharacters.find((c) => c.name === 'Tam Rook')!
  const retired = {
    ...w.ideal,
    statusFlips: [{ ref: tam.handle, to: 'retired' as const, reason: 'ran', sourceTurn: 't2' }],
  }
  expect(holds(w.ideal)).toBe(true)
  expect(holds(retired)).toBe(false)
})

it('the learning window counts a death told beside a flight as Tam’s unless it is Senna’s', () => {
  const w = EVAL_WINDOWS.find((x) => x.name === 'learning')!
  const holds = w.checks.find((c) => c.name === 'no description tells Tam as dead')!.holds
  const telling = (description: string) => ({
    ...w.ideal,
    newCharacters: w.ideal.newCharacters.map((c) =>
      c.name === 'Tam Rook' ? { ...c, description } : c,
    ),
  })
  expect(holds(telling('The cupbearer who fled the night she died.'))).toBe(true)
  expect(holds(telling('The cupbearer, who fled, then was found dead.'))).toBe(false)
})

it('the defection window finds the theft at its own turns, not in the bargain', () => {
  const w = EVAL_WINDOWS.find((x) => x.name === 'defection')!
  const holds = w.checks.find((c) => c.name.startsWith('the ledger theft'))!.holds
  const bargain = {
    title: 'Brann sells the ledgers to House Varro',
    involvements: [
      { ref: 'char_brann', role: 'seller' },
      { ref: 'char_maela', role: 'buyer' },
    ],
    awareness: [],
    sourceTurn: 't2',
  }
  expect(holds(w.ideal)).toBe(true)
  expect(holds({ ...w.ideal, happenings: [bargain] })).toBe(false)
})

it('the recounted window scores only a thread taking the page to court', () => {
  const w = EVAL_WINDOWS.find((x) => x.name === 'recounted')!
  const holds = w.checks.find((c) => c.name.endsWith('is a new thread'))!.holds
  const thread = {
    title: 'The son in the hall',
    description: 'Vane’s son still rules Ostmark.',
    status: 'active' as const,
    sourceTurn: 't4',
  }
  expect(holds(w.ideal)).toBe(true)
  expect(holds({ ...w.ideal, newThreads: [thread] })).toBe(false)
})

it("the defection window leaves the warrant's signer unscored, and counts the hanged brother", () => {
  const w = EVAL_WINDOWS.find((x) => x.name === 'defection')!
  const holds = w.checks.find((c) => c.name.startsWith('no new character but'))!.holds
  const adding = (name: string) => ({
    ...w.ideal,
    newCharacters: [{ handle: 'new:x', name, description: 'x', keywords: [], sourceTurn: 't2' }],
  })
  expect(holds(adding('the man who signed that warrant'))).toBe(true)
  expect(holds(adding("Brann's brother"))).toBe(false)
})

it('the namedrops window finds Jorun Vask by his name, not in any new character', () => {
  const w = EVAL_WINDOWS.find((x) => x.name === 'namedrops')!
  const holds = w.checks.find((c) => c.name.startsWith('Jorun Vask'))!.holds
  const jorun = w.ideal.newCharacters[0]
  expect(holds(w.ideal)).toBe(true)
  expect(holds({ ...w.ideal, newCharacters: [{ ...jorun, name: 'Saint Aldric' }] })).toBe(false)
})

it('the switch window credits the break-in by awareness as by involvement', () => {
  const w = EVAL_WINDOWS.find((x) => x.name === 'switch')!
  const isWennas = w.checks.find((c) => c.name.startsWith('the archive break-in is Wenna’s'))!.holds
  const notDaces = w.checks.find((c) => c.name.startsWith('the archive break-in is not'))!.holds
  const breakInKnownTo = (ref: string) =>
    reply({
      happenings: [
        {
          title: 'The Calder Shoals chart is stolen from the archive',
          involvements: [{ ref: 'loc_archive', role: 'site' }],
          awareness: [{ ref, source: 'was told', severity: 0.5 }],
          sourceTurn: 't2',
        },
      ],
    })
  expect(isWennas(breakInKnownTo('char_wenna'))).toBe(true)
  expect(notDaces(breakInKnownTo('char_dace'))).toBe(false)
})

it('the switch window’s bad reply, the break-in Dace’s and the passage Wenna’s, fails both expect checks', () => {
  const w = EVAL_WINDOWS.find((x) => x.name === 'switch')!
  expect(w.checks.filter((c) => c.kind === 'expect').map((c) => [c.name, c.holds(w.bad)])).toEqual([
    [
      'the archive break-in is Wenna’s: a happening telling it involves her or gives her awareness',
      false,
    ],
    [
      'the ring paid for passage is Dace’s: a happening telling it involves him or gives him awareness',
      false,
    ],
  ])
})

it('the switch window takes a palm in the crossing and a passage in the break-in for neither fact', () => {
  const w = EVAL_WINDOWS.find((x) => x.name === 'switch')!
  const r = reply({
    happenings: [
      {
        title: 'Wenna steals the Calder Shoals chart',
        description:
          'Wenna slips through the passage behind the counting floor and takes the chart.',
        involvements: [{ ref: 'char_wenna', role: 'actor' }],
        awareness: [],
        sourceTurn: 't2',
      },
      {
        title: 'Dace pays Ebbe Lunt for the crossing',
        description: 'Dace presses his father’s silver ring into Lunt’s palm.',
        involvements: [{ ref: 'char_dace', role: 'actor' }],
        awareness: [],
        sourceTurn: 't4',
      },
    ],
  })
  const attribution = [
    'the archive break-in is Wenna’s: a happening telling it involves her or gives her awareness',
    'the archive break-in is not credited to Dace, the lead after it',
    'the ring paid for passage is Dace’s: a happening telling it involves him or gives him awareness',
    'the ring paid for passage is not credited to Wenna',
  ]
  expect(
    attribution.map((name) => [name, w.checks.find((c) => c.name === name)!.holds(r)]),
  ).toEqual(attribution.map((name) => [name, true]))
})

it('the switch window takes a crossing that "locks in" passage for no break-in', () => {
  const w = EVAL_WINDOWS.find((x) => x.name === 'switch')!
  const r = reply({
    happenings: [
      {
        title: 'Wenna steals the Calder Shoals chart',
        description: 'Wenna picks the archive lock and takes the chart.',
        involvements: [{ ref: 'char_wenna', role: 'actor' }],
        awareness: [],
        sourceTurn: 't2',
      },
      {
        title: 'Dace locks in his crossing',
        description: 'Dace locks in a place on the Skell ferry with his father’s silver ring.',
        involvements: [{ ref: 'char_dace', role: 'actor' }],
        awareness: [],
        sourceTurn: 't4',
      },
    ],
  })
  const attribution = [
    'the archive break-in is Wenna’s: a happening telling it involves her or gives her awareness',
    'the archive break-in is not credited to Dace, the lead after it',
    'the ring paid for passage is Dace’s: a happening telling it involves him or gives him awareness',
    'the ring paid for passage is not credited to Wenna',
  ]
  expect(
    attribution.map((name) => [name, w.checks.find((c) => c.name === name)!.holds(r)]),
  ).toEqual(attribution.map((name) => [name, true]))
})

// architecture.md → System and user halves: a window whose lead never changed renders no mark.
const LEAD_MARK = 'from this turn on, '
const LEAD_CLAUSE = 'except where a turn names another'

describe.each(EVAL_WINDOWS.filter((w) => w.name !== 'switch').map((w) => [w.name, w] as const))(
  'eval window %s, never switched',
  (_, w) => {
    it('renders no lead mark, no explanation of marks and no clause', () => {
      const { prompt } = renderWindow(w, MAX_ENTRIES)
      expect(prompt.user).not.toContain(LEAD_MARK)
      expect(prompt.user).not.toContain('a turn where the lead changes')
      expect(prompt.user).not.toContain(LEAD_CLAUSE)
    })
  },
)

// Turns 1–2 under the former lead, 3–4 under the lead: t1 differs from the lead the prompt names.
it('the switch window marks t1 with its former lead and t3 with its lead, and no other turn', () => {
  const w = EVAL_WINDOWS.find((x) => x.name === 'switch')!
  const lead = w.lead!
  const former = w.entries[0]!.metadata!.leadId!
  expect(former).not.toBe(lead)
  expect(w.entries.map((e) => e.metadata?.leadId)).toEqual([former, former, lead, lead])

  const { prompt, legend } = renderWindow(w, MAX_ENTRIES)
  const nameOf = (id: string) => w.entities.find((e) => e.id === id)!.name
  const header = (handle: string) =>
    prompt.user.split('\n').find((line) => line.startsWith(`[${handle}]`))!
  const marked = (handle: string, id: string) => {
    expect(legend.get(id)).toMatch(/^c\d+$/)
    const expected = `[${handle}] ${LEAD_MARK}"I" and "you" are [${legend.get(id)}] ${nameOf(id)}`
    expect(header(handle).slice(0, expected.length)).toBe(expected)
  }

  marked('t1', former)
  expect(header('t2')).not.toContain(LEAD_MARK)
  marked('t3', lead)
  expect(header('t4')).not.toContain(LEAD_MARK)
  expect(prompt.user).toContain(LEAD_CLAUSE)
})
