import { describe, expect, it } from 'vitest'

import {
  classifierExtractionSchema,
  classifierExtractionWithPlacesSchema,
  NEW_HANDLE_PREFIX,
} from '@/lib/classifier'

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
  placesUnplaced: [],
  happenings: [{ id: 'hp1', title: 'The satchel was stolen' }],
  threads: [{ id: 'th1', title: 'Recover the satchel', status: 'active' }],
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

  // The reply drops a sourceTurn sent where the field doesn't exist, and the turn it meant with it.
  it('asks for sourceTurn on every entry that has the field, naming those that have none', () => {
    expect(render().system).toContain(
      "- Provenance. Set sourceTurn on every entry that has the field, and on no other, to the handle of the turn the fact comes from: a happening's involvements and awareness, and a knownAwareness entry, have none. For a fact synthesised across turns,",
    )
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
  it('opens the system half with the role line, then the rules every list keeps', () => {
    const lines = render().system.split('\n')
    expect(lines.slice(0, 4)).toEqual([
      'You are extracting structured world state from recent story prose. Report only what the prose supports; never invent.',
      '',
      'Rules for every list:',
      '',
    ])
    expect(lines[4]).toMatch(/^- Provenance\. /)
  })

  // Each list's rules sit where the model is about to write it: a rule read far from its list went
  // unheeded (the evaluation set's knownAwareness).
  it.each([
    [false, classifierExtractionSchema],
    [true, classifierExtractionWithPlacesSchema],
  ])(
    'heads its rules with every reply list in the order the reply writes them (places %s)',
    (mentionedPlaces, schema) => {
      const headed = render({ mentionedPlaces })
        .system.split('\n')
        .flatMap((line) => /^Rules for (.+):$/.exec(line)?.[1]?.split(/, | and /) ?? [])
      expect(headed).toEqual(['every list', ...Object.keys(schema.shape)])
    },
  )

  // The lists sit in the user half, so a rule cannot point at them by position.
  it('names the lists its rules refer to instead of pointing above', () => {
    const { system } = render()
    expect(system).toContain(
      'Add a character the prose introduces who is not in the Known entities list:',
    )
    expect(system).toContain('so it can never be confused with a listed ID.')
    expect(system).toContain(
      "by a title, epithet or name form its line in Known entities or Places doesn't show",
    )
    expect(system).not.toMatch(/\babove\b/)
  })

  // classifier.md → What the classifier writes → New characters: the bar factions and places keep.
  it('adds a named character or an unnamed one the story could come back to, never a passing figure', () => {
    const { system } = render()
    expect(system).toContain(
      'a named one, or an unnamed one the story could come back to ("the innkeeper who hid them"). Not a passing figure there only for the moment ("a porter", "a soldier in the crowd"). Put each in newCharacters with a handle you choose.',
    )
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

  // classifier.md → What the classifier reads: the unplaced places in a group of their own.
  const unplaced = [
    {
      id: 'l5',
      name: 'Varn',
      depth: 0,
      status: 'active',
      retiredReason: null,
      description: 'A river town.',
      keywords: ['the ford town'],
    },
    {
      id: 'l6',
      name: 'Varn Docks',
      depth: 1,
      status: 'staged',
      retiredReason: null,
      description: null,
      keywords: [],
    },
  ]

  it('lists the unplaced places after the tree under Unplaced:, a level in, with IDs', () => {
    const { user, system } = render({ places, placesUnplaced: unplaced })
    expect(user).toContain(
      [
        '    - [l4] Old Well (retired)',
        'Unplaced:',
        '  - [l5] Varn — A river town. (also called: the ford town)',
        '    - [l6] Varn Docks (staged)',
        '',
        'Known relationships',
      ].join('\n'),
    )
    expect(system).not.toContain('Unplaced:')
  })

  it('prints (none) only when neither the tree nor the group holds a place', () => {
    const onlyUnplaced = render({ places: [], placesUnplaced: unplaced }).user
    expect(onlyUnplaced).toContain(
      'Places, same ID rule — each nested under the place it is part of:\nUnplaced:\n  - [l5] Varn',
    )
    expect(onlyUnplaced).not.toContain('(none)\n\nKnown relationships')
    expect(render({ places }).user).not.toContain('Unplaced:')
  })

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
    expect(on.system).toContain(
      "A new place's handle must differ from every newCharacters and newFactions handle and from every other new place's, even when a character or a faction shares its name.",
    )
    expect(on.system).toContain(
      'When the turns don\'t say, set parent to "top-level" only when nothing in Places could contain the place, as for a city when Places holds only cities; leave parent out when something could contain it, and when unsure.',
    )
    expect(on.user).not.toContain('newPlaces')

    const off = render({ mentionedPlaces: false })
    expect(off.system).not.toContain('New places')
    expect(off.system).not.toContain('newPlaces')
    // The rule leaves no gap behind it either way.
    expect(off.system).toMatch(/knownAwareness stays empty\.$/)
    expect(on.system).toMatch(
      /knownAwareness stays empty\.\n\nRules for newPlaces:\n\n- New places\. /,
    )
  })
})

// classifier.md → Factions.
describe('periodic classifier template — factions', () => {
  const FACTION_RULE =
    'Add a faction when the prose establishes an organized group with its own identity in the story\'s world: a named one (a guild, an order, a noble house, a gang, a church, a government), or an unnamed one the story could come back to ("the smugglers who run the docks"). Not a loose crowd or a kind of person ("the guards", "the villagers"), not one that exists only in a hypothetical, a dream or a figure of speech, and not one already in Known entities, even under another name: use its ID and add the name form as an alias.'
  const MEMBERSHIP_RULE =
    'Set a character\'s faction when the turns establish which organized group they belong to now: they join it, are revealed as a member, or change sides. Set it to none when they leave it or are cast out. A change of sides is one fact naming the new faction: no fact sets none for the faction they leave. Only their main allegiance: a secondary tie, a past membership ("once of the Iron Circle"), a disguise or a cover story doesn\'t change it. Emit a fact only when the turns establish one or change the faction their line shows.'

  it.each([true, false])(
    'carries both rules in the system half, whatever the places setting: %s',
    (mentionedPlaces) => {
      const { system, user } = render({ mentionedPlaces })
      expect(system).toContain(`- New factions. ${FACTION_RULE}`)
      expect(system).toContain(`- Memberships. ${MEMBERSHIP_RULE}`)
      expect(system).toMatch(/newFactions with a handle that starts with "new:"/)
      expect(system).toContain(
        "A new faction's handle must differ from every newCharacters handle and from every other new faction's.",
      )
      expect(system).toMatch(
        /faction set to the faction's ID, a new faction's handle, or null for none/,
      )
      expect(user).not.toContain('newFactions')
      expect(user).not.toContain('memberships')
    },
  )

  it("shows a character's faction on its line, and nothing when it has none", () => {
    const { user } = render({
      entities: [
        {
          id: 'c1',
          name: 'Kael',
          kind: 'character',
          status: 'active',
          description: 'A courier.',
          keywords: [],
          faction: 'f1',
        },
        {
          id: 'c2',
          name: 'Aria',
          kind: 'character',
          status: 'active',
          description: 'His sister.',
          keywords: [],
          faction: null,
        },
        {
          id: 'f1',
          name: 'The Iron Circle',
          kind: 'faction',
          status: 'active',
          description: null,
          keywords: [],
          faction: null,
        },
      ],
    })
    expect(user).toContain('- [c1] Kael (character) — A courier. (faction: [f1])')
    expect(user).toContain('- [c2] Aria (character) — His sister.\n')
    expect(user).toContain('- [f1] The Iron Circle (faction)\n')
  })
})

// classifier.md → What the classifier reads: a faction's standing, the Threads list.
describe('periodic classifier template — standing and threads', () => {
  it("shows a faction's standing on its line, and nothing when it has none", () => {
    const { user } = render({
      entities: [
        {
          id: 'f1',
          name: 'The Iron Circle',
          kind: 'faction',
          status: 'active',
          description: 'Smiths.',
          keywords: [],
          faction: null,
          standing: 'at war with the crown',
        },
        {
          id: 'f2',
          name: 'The Tidewardens',
          kind: 'faction',
          status: 'active',
          description: null,
          keywords: [],
          faction: null,
          standing: null,
        },
      ],
    })
    expect(user).toContain(
      '- [f1] The Iron Circle (faction) — Smiths. (standing: at war with the crown)\n',
    )
    expect(user).toContain('- [f2] The Tidewardens (faction)\n')
  })

  it('lists the threads by ID, title and status between Known happenings and the turns', () => {
    const { user, system } = render({
      threads: [
        { id: 'th1', title: 'Recover the satchel', status: 'active' },
        { id: 'th2', title: 'Find the heir', status: 'pending' },
      ],
    })
    expect(user).toContain(
      [
        '- [hp1] The satchel was stolen',
        '',
        'Threads, same ID rule — each with its status:',
        '- [th1] Recover the satchel (active)',
        '- [th2] Find the heir (pending)',
        '',
        'Turns to classify.',
      ].join('\n'),
    )
    expect(system).not.toContain('[th1]')
  })

  it('prints (none) when no thread is listed', () => {
    expect(render({ threads: [] }).user).toContain(
      'Threads, same ID rule — each with its status:\n(none)\n\nTurns to classify.',
    )
  })
})

// classifier.md → What the classifier writes: a rule in the system half for every new write.
describe('periodic classifier template — the writer map rules', () => {
  const RULES = [
    [
      'titles',
      '- Titles. Give every happening a title, a few words naming the event as a chapter heading would ("The duel at the mill"), and a description of what happened, from the prose. A happening without a title is dropped, with its involvements and awareness.\n',
    ],
    [
      'status changes',
      '- Status changes. Put each move to active or retired in statusFlips, with the ID from Known entities or Places as ref, the new status as to, and the sourceTurn. Give a retirement its reason, a short phrase from the prose ("killed at the ford").\n',
    ],
    [
      'promotion',
      '- Promotion. Move a staged entity of any kind to active only when the prose actually brings it into the scene.\n',
    ],
    [
      'when it happened',
      '- When it happened. A happening sits at its sourceTurn, where the turns show it happen. For an event from before the story or offstage that the turns only recount, or a backdrop that holds throughout, set temporal instead: its time as the prose gives it ("ten winters ago", "since the war"), or a short phrase when the prose gives none ("before the story", "ongoing"). An event still to come is not a happening: put the plan in newThreads, and add the event when the turns show it happen. Hearing of it can be one, at that turn.\n',
    ],
    [
      'returns',
      "- Returns. Move a retired character back to active only when the turns put them in the scene now: not a memory, a flashback, a vision or someone's report of them. Never a place.\n",
    ],
    [
      'standing',
      '- Standing. A faction\'s line in Known entities shows its standing after "standing:". When the turns establish a change in a listed faction\'s position (it declares war, is outlawed, comes to power), add a standings entry with its ID as ref, the new standing in a short phrase, and the sourceTurn. Emit one only when the turns change it.\n',
    ],
    [
      'names',
      '- Names. When the turns establish a listed entity\'s own name, a reveal ("the hooded stranger is Kael"), add a renames entry with its ID as ref, the name, and the sourceTurn; the app keeps its old name as an alias. An alias, a title, a disguise, or a shortened or fuller form of its name is not its name: put it in aliases. Add the entry even when another listed entity holds that name: the user is asked to merge the two.\n',
    ],
    [
      'where places sit',
      '- Where places sit. When the turns establish where a place in the unplaced group of Places lies, or move a place in Places into another, add a placements entry with its ID as ref, parent set to the ID from Places of the place it is now part of, and the sourceTurn. Set parent to "top-level" only for an unplaced place nothing in Places could contain, as for a city when Places holds only cities.\n',
    ],
    [
      'threads',
      "- Threads. Add a thread when the turns set up something the story will follow past the current scene: a goal a character commits to, a quest given, a mystery raised, a threat that looms, an event set for later. Not a passing intention, and not one already in the Threads list, even worded differently: change its status instead. Emit a status only when the turns establish the change. Put each new thread in newThreads with a title, a short description, its status (pending when the story knows of it but no one pursues it, active when someone does) and the sourceTurn. A thread the turns both open and close goes in newThreads as resolved or failed, with sourceTurn the turn that opened it and resolvedAtTurn the turn that closed it. Put each change in threadStatuses with the listed thread's ID as thread, the new status (active when it is taken up, resolved when it is achieved, failed when it is made impossible) and the sourceTurn. threadStatuses is for those listed threads alone: a thread this reply adds carries its status in its own newThreads entry and never appears in threadStatuses.\n",
    ],
    [
      'categories and icons',
      '- Categories and icons. Give each happening and each new thread a free-form category (a battle, a betrayal, a quest) and, when one fits, an icon from the list its icon field gives.\n',
    ],
  ] as const

  it.each(RULES)('carries the %s rule whatever the places setting', (_name, rule) => {
    for (const mentionedPlaces of [true, false]) {
      const { system, user } = render({ mentionedPlaces })
      expect(system).toContain(rule)
      expect(user).not.toContain(rule.trim())
    }
  })

  // classifier.md → What the classifier writes → Happenings: awareness is who knows, however
  // they came to, for an added happening and a listed one alike.
  it('lists who witnessed or took part in a happening as well as who learns of it', () => {
    expect(render().system).toContain(
      '- Awareness. List only characters the prose shows knowing of it, however they came to: who witnessed it or took part, and who learns of it.',
    )
  })

  // Without its last sentence, replies filed who learned of a happening they added under
  // knownAwareness, naming it by title.
  it('sends awareness of a listed happening to knownAwareness, and of an added one to its own', () => {
    const { system } = render()
    expect(system).toContain(
      'If a character learns of it after it happened, or learns of a past one, set learnedAtTurn to the turn that narrated the learning.\n',
    )
    expect(system).toContain(
      "Rules for knownAwareness:\n\n- Never add again a happening Known happenings lists: when the turns show a character knowing of one, learning of it (\"Kael tells Aria about the massacre\") or knowing it already (Kael, who tells it), add a knownAwareness entry with its ID as happening, the character's ID or a new character's handle as ref, source, severity, and learnedAtTurn when the turns narrate the learning. knownAwareness is for those listed happenings alone: who knows of a happening this reply adds goes in that happening's own awareness, and when the turns show no one knowing of a listed happening, knownAwareness stays empty.",
    )
  })

  // data-model.md → Soft caps: the caps are stated where the profile is asked for.
  it("asks a new entry for its first profile within the soft caps, a new place's condition only with the setting on", () => {
    const PROFILE =
      '- First profiles. Give a newCharacters entry the profile the turns show: visual (physique, face, hair, eyes, attire, distinguishing), traits (at most 8), drives (at most 6) and voice. Give a newFactions entry its standing and agenda (at most 4).'
    const on = render({ mentionedPlaces: true }).system
    const off = render({ mentionedPlaces: false }).system
    expect(on).toContain(
      `${PROFILE} Give a newPlaces entry the condition the turns show it in. Leave out whatever the prose doesn't show.\n`,
    )
    expect(off).toContain(`${PROFILE} Leave out whatever the prose doesn't show.\n`)
  })
})
