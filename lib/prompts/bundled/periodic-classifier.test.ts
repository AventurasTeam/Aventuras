import { describe, expect, it } from 'vitest'

import { NEW_HANDLE_PREFIX } from '@/lib/classifier'

import { renderTemplate, TEMPLATE_IDS } from '..'

const context = {
  turns: [
    { handle: 't1', content: 'Kael falls at the ford, lifeless.', scene: ['c1'], location: 'l1' },
    { handle: 't2', content: 'Aria hears of it from Jorin.', scene: [], location: null },
  ],
  entities: [
    {
      id: 'c1',
      name: 'Kael',
      kind: 'character',
      status: 'active',
      description: 'A courier.',
      keywords: ['the Grey Wolf', 'the courier'],
    },
    {
      id: 'c2',
      name: 'Aria',
      kind: 'character',
      status: 'staged',
      description: 'His sister.',
      keywords: [],
    },
  ],
  places: [
    {
      id: 'l1',
      name: 'The ford',
      depth: 0,
      status: 'active',
      retiredReason: null,
      description: null,
      keywords: [],
    },
  ],
  happenings: [{ id: 'hp1', title: 'The satchel was stolen' }],
  relationships: [
    { subject: 'c1', subjectName: 'Kael', object: 'c2', objectName: 'Aria', kind: 'sister' },
  ],
  lore: [],
  definition: { setting: '', genre: { promptBody: '' }, tone: { promptBody: '' } },
  calendarVocabulary: null,
}

const render = (over: Record<string, unknown> = {}) =>
  renderTemplate(TEMPLATE_IDS.periodicClassifier, { ...context, ...over })

describe('periodic classifier template', () => {
  it('carries the hard-finality retirement directive', () => {
    const rendered = render()
    expect(rendered).toMatchSnapshot()
    expect(rendered.system).toMatch(/only on unambiguous/i)
    expect(rendered.system).toMatch(/wandered off/i)
  })

  // classifier.md → What the classifier writes: never a location.
  it('names only characters and factions as retirable', () => {
    expect(render().system).toContain('Move a character or faction to retired only on')
  })

  it('labels every window turn with its provenance handle', () => {
    const { user } = render()
    expect(user).toContain('[t1]')
    expect(user).toContain('[t2]')
  })

  // The cross-turn attribution rule is a PROMPT obligation, not planner logic:
  // the schema carries one sourceTurn per fact, so nothing downstream can
  // enforce "latest contributing turn". This assertion is its only guard.
  it('instructs latest-contributing-turn attribution for cross-turn synthesis', () => {
    expect(render().system).toMatch(/latest contributing turn/i)
  })

  it('instructs one-perspective-only relationship emission', () => {
    expect(render().system).toMatch(/do not infer the inverse/i)
  })

  // The reserved namespace is what keeps a newCharacters handle out of the
  // placeholder space; substituteClassifierIds defends the case anyway, but an
  // unprefixed instruction invites the collision on every reply.
  it('reserves the new: namespace for newCharacters handles', () => {
    const { system } = render()
    expect(system).toContain(NEW_HANDLE_PREFIX)
    expect(system).toMatch(/MUST start with/i)
  })

  // A schema field the prompt never asks for is a field the model never fills.
  it('asks for the epithets a new character is named by', () => {
    const { system } = render()
    expect(system).toMatch(/keywords/i)
    expect(system).toMatch(/epithets/i)
  })

  it('exposes the placeholder universe including happenings', () => {
    const { user } = render()
    expect(user).toContain('[c1]')
    expect(user).toContain('[hp1]')
  })

  it('renders (none) for an empty entity and happening universe', () => {
    expect(render({ entities: [], happenings: [], relationships: [] }).user).toContain('(none)')
  })

  it('renders a stored relationship view as a subject-sees-object line', () => {
    expect(render().user).toContain('- [c1] Kael sees [c2] Aria as: sister')
  })

  // classifier.md → What the classifier reads: the saved scene rides each turn.
  it("shows a turn's saved scene and location after its handle, prose on the next line", () => {
    const { user } = render()
    expect(user).toContain('[t1] scene: [c1]; location: [l1]\nKael falls at the ford, lifeless.')
    expect(user).toContain('\n[t2]\nAria hears of it from Jorin.')
    expect(user).toContain('scene and location, by the same ID rule, may follow the handle')
  })

  it('renders a scene without a location, and a location without a scene', () => {
    const { user } = render({
      turns: [
        { handle: 't1', content: 'Both are here.', scene: ['c1', 'c2'], location: null },
        { handle: 't2', content: 'At the ford.', scene: [], location: 'l1' },
      ],
    })
    expect(user).toContain('[t1] scene: [c1], [c2]\nBoth are here.')
    expect(user).toContain('[t2] location: [l1]\nAt the ford.')
  })

  it("lists an entity's stored keywords on its line, and nothing when it has none", () => {
    const { user } = render()
    expect(user).toContain(
      '- [c1] Kael (character) — A courier. (also called: the Grey Wolf, the courier)\n',
    )
    expect(user).toContain('- [c2] Aria (character, staged) — His sister.\n')
  })

  it('tells the model that prose naming an entity in its turn scene or location refers to it', () => {
    expect(render().system).toMatch(
      /Prose naming an entity in its turn's scene, or its location, refers to that entity/,
    )
  })

  // classifier.md → What the classifier reads: a name form of a listed character takes its ID.
  it('steers a name form of a listed character to its ID and the alias list', () => {
    const { system } = render()
    expect(system).toMatch(
      /A shortened or fuller name, a title or an alias of a listed character is that character unless the prose shows it is someone else/,
    )
    expect(system).toMatch(/put the new name form in aliases/)
  })

  // A schema field the prompt never asks for is a field the model never fills.
  it('asks for an aliases entry for a listed entity of any kind', () => {
    const { system } = render()
    expect(system).toMatch(/- Aliases\. When the prose calls a listed entity of any kind/)
    expect(system).toMatch(/Leave out forms its line already shows/)
  })
})

// architecture.md → System and user halves; classifier.md → What the classifier reads.
describe('periodic classifier template — system and user halves', () => {
  it('opens the system half with the role line, then the rules', () => {
    const lines = render().system.split('\n')
    expect(lines.slice(0, 4)).toEqual([
      'You are extracting structured world state from recent story prose. Report only what the prose supports; never invent.',
      '',
      'Rules:',
      '',
    ])
    expect(lines[4]).toMatch(/^- Provenance\. /)
    expect(lines.at(-1)).toBe(
      '- Silence is valid. Return empty arrays for anything the prose does not support.',
    )
  })

  // The lists sit in the user half, so a rule cannot point at them by position.
  it('names the lists its rules refer to instead of pointing above', () => {
    const { system } = render()
    expect(system).toContain(
      'A character the prose introduces who is not in the Known entities list goes in newCharacters',
    )
    expect(system).toContain('so it can never be confused with a listed ID.')
    expect(system).toContain(
      "by a title, epithet or name form its line in Known entities or Places doesn't show",
    )
    expect(system).not.toMatch(/\babove\b/)
  })

  // The turns arrive after the rules, so "these turns" has nothing to point at.
  it('names the turns to classify instead of pointing at them', () => {
    const { system } = render()
    expect(system).toContain(
      'only when the turns to classify establish a view or change a listed one',
    )
    expect(system).not.toMatch(/these turns/i)
  })

  it('carries the Known lists and the turns in the user half, and none of the rules', () => {
    const { user } = render()
    const lines = user.split('\n')
    expect(lines[0]).toBe(
      'Known entities, referenced only by the ID shown in brackets — write it without the brackets, never invent one:',
    )
    expect(lines.at(-1)).toBe('Aria hears of it from Jorin.')
    expect(user).not.toContain('Rules:')
    expect(user).not.toContain('You are extracting structured world state')
  })
})

// classifier.md → Mentioned places.
describe('periodic classifier template — places', () => {
  const RULE =
    'Add a place the turns mention but the scene doesn\'t enter when the prose establishes it exists in the story\'s world with its own identity: a named place (a town, a keep, a region, an inn), or an unnamed one the story could come back to ("the old mill on the ridge"). Not a generic kind of place ("a tavern", "the road north"), not one that exists only in a hypothetical, a dream or a figure of speech, and not a place already in the Places list, even under another name: use its ID and add the name form as an alias.'

  const places = [
    {
      id: 'l1',
      name: 'Ashen Keep',
      depth: 0,
      status: 'active',
      retiredReason: null,
      description: 'A burnt hillfort.',
      keywords: ['the keep'],
    },
    {
      id: 'l2',
      name: 'Great Hall',
      depth: 1,
      status: 'staged',
      retiredReason: null,
      description: null,
      keywords: [],
    },
    {
      id: 'l3',
      name: 'The Crypt',
      depth: 1,
      status: 'retired',
      retiredReason: 'sealed by the abbot',
      description: null,
      keywords: [],
    },
    {
      id: 'l4',
      name: 'Old Well',
      depth: 2,
      status: 'retired',
      retiredReason: null,
      description: null,
      keywords: [],
    },
  ]

  it.each([true, false])(
    'renders the Places tree in the user half, setting on: %s',
    (mentionedPlaces) => {
      const { user, system } = render({ places, mentionedPlaces })
      expect(user).toContain(
        [
          'Places, same ID rule — each nested under the place it is part of:',
          '- [l1] Ashen Keep — A burnt hillfort. (also called: the keep)',
          '  - [l2] Great Hall (staged)',
          '  - [l3] The Crypt (retired: sealed by the abbot)',
          '    - [l4] Old Well (retired)',
          '',
          'Known relationships',
        ].join('\n'),
      )
      expect(system).not.toContain('[l1]')
    },
  )

  it('sits between Known entities and Known relationships, (none) when empty', () => {
    const { user } = render({ places: [] })
    expect(user).toContain('— A courier.')
    expect(user.indexOf('Known entities')).toBeLessThan(user.indexOf('Places, same ID rule'))
    expect(user).toContain(
      'Places, same ID rule — each nested under the place it is part of:\n(none)\n',
    )
  })

  it('adds the significance rule to the system half only with the setting on', () => {
    const on = render({ mentionedPlaces: true })
    expect(on.system).toContain(`- New places. ${RULE}`)
    expect(on.system).toMatch(/newPlaces with a handle that starts with "new:"/)
    expect(on.system).toMatch(/leave parent out when the turns don't say/)
    expect(on.user).not.toContain('newPlaces')

    const off = render({ mentionedPlaces: false })
    expect(off.system).not.toContain('New places')
    expect(off.system).not.toContain('newPlaces')
    // The rule leaves no gap behind it either way.
    for (const { system } of [on, off]) expect(system).toMatch(/\n- Silence is valid\./)
    expect(off.system).toMatch(/already shows\.\n- Silence is valid\./)
  })
})
