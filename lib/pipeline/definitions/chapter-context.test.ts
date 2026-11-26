import { describe, expect, it } from 'vitest'

import type { Thread, ThreadStatus } from '@/lib/db'
import {
  bundledPack,
  loadPack,
  MACRO_IDS,
  renderTemplate,
  TEMPLATE_IDS,
  templateReads,
  VARIABLES,
} from '@/lib/prompts'
import { renderWith } from '@/lib/prompts/engine'
import {
  BOUNDARY_ONLY_CHAPTER_VARIABLES,
  CLOSE_ONLY_CHAPTER_VARIABLES,
  MERGE_ONLY_CHAPTER_VARIABLES,
} from '@/lib/prompts/templateContextMap'

import {
  buildChapterContext,
  buildChapterMergeContext,
  buildCloseTurns,
  type CloseRangeEntry,
} from './chapter-context'

function entry(position: number, kind: CloseRangeEntry['kind'], content: string): CloseRangeEntry {
  return {
    id: `entry_close_${position}`,
    branchId: 'b1',
    position,
    kind,
    content,
    contentTokens: null,
    chapterId: null,
    metadata: null,
    createdAt: position,
  }
}

const thread = (title: string, status: ThreadStatus): Pick<Thread, 'title' | 'status'> => ({
  title,
  status,
})

const ENTRIES = [
  entry(
    1,
    'opening',
    'The marsh road ended at a wall of black water, and the keep stood beyond it.',
  ),
  entry(2, 'user_action', 'I wade in, holding the sigil above my head.'),
  entry(
    3,
    'ai_reply',
    'The cold takes your breath. On the far bank Mora raises a shuttered lantern.\n<state><summary>The crossing</summary></state>',
  ),
]

const THREADS = [
  thread('Find the heir', 'active'),
  thread('The debt\nto the guild', 'pending'),
  thread('The lost map', 'resolved'),
  thread('Warn the abbey', 'failed'),
]

const SUMMARY = 'Kael left the keep at dawn with the stolen sigil.'

// A story told in the second person with no lead and no stamps: no lead line and no mark.
const NO_LEAD = {
  lead: null,
  narration: 'second',
  nameOf: (): string | undefined => undefined,
} as const

// The close-only variables are a close task's to set, the merge-only ones the merge's and the
// boundary-only ones boundary selection's; the whole-chapter and part calls read the rest.
const notMetadata: readonly string[] = [
  ...CLOSE_ONLY_CHAPTER_VARIABLES,
  ...MERGE_ONLY_CHAPTER_VARIABLES,
  ...BOUNDARY_ONLY_CHAPTER_VARIABLES,
]
const metadataVariables = (): string[] =>
  VARIABLES.chapter.map((v) => v.name).filter((name) => !notMetadata.includes(name))

// Each mode's paragraph on reading a user's turn (ui/principles.md → Mode), as the system says it.
const ADVENTURE_TURN_RULE = 'Each is what the lead does, says or attempts'
const CREATIVE_TURN_RULE = 'Each is a direction or prose'

describe('buildChapterContext', () => {
  it('emits exactly the variables pinned for the chapter group, the close-only ones aside', () => {
    const context = buildChapterContext({
      entries: ENTRIES,
      previousChapterSummary: null,
      threads: [],
      mode: 'adventure',
      ...NO_LEAD,
    })
    expect(Object.keys(context).sort()).toEqual(metadataVariables().sort())
  })

  it.each([TEMPLATE_IDS.chapterMetadata, TEMPLATE_IDS.chapterMetadataPart])(
    'is what %s reads, and all of it',
    (templateId) => {
      expect([...templateReads(templateId)].sort()).toEqual(metadataVariables().sort())
    },
  )

  // Only a close task's, the merge's or boundary's render sets these; the metadata call's leaves them.
  it('sets none of the close-only, merge-only or boundary-only variables', () => {
    const context: Record<string, unknown> = buildChapterContext({
      entries: ENTRIES,
      previousChapterSummary: SUMMARY,
      threads: THREADS,
      mode: 'adventure',
      ...NO_LEAD,
    })
    expect(CLOSE_ONLY_CHAPTER_VARIABLES).toContain('closeCharacters')
    expect(CLOSE_ONLY_CHAPTER_VARIABLES.filter((name) => Object.hasOwn(context, name))).toEqual([])
    expect(MERGE_ONLY_CHAPTER_VARIABLES.filter((name) => Object.hasOwn(context, name))).toEqual([])
    expect(BOUNDARY_ONLY_CHAPTER_VARIABLES.filter((name) => Object.hasOwn(context, name))).toEqual(
      [],
    )
  })

  // A row written before the write-path strip still carries its trailing block, and an entry id
  // would leak raw: `entry_` doesn't substitute.
  it('projects each entry to its position, kind and prose', () => {
    const { entries } = buildChapterContext({
      entries: ENTRIES,
      previousChapterSummary: null,
      threads: [],
      mode: 'adventure',
      ...NO_LEAD,
    })
    expect(entries).toEqual([
      {
        position: 1,
        kind: 'opening',
        content: 'The marsh road ended at a wall of black water, and the keep stood beyond it.',
      },
      { position: 2, kind: 'user_action', content: 'I wade in, holding the sigil above my head.' },
      {
        position: 3,
        kind: 'ai_reply',
        content: 'The cold takes your breath. On the far bank Mora raises a shuttered lantern.',
      },
    ])
  })

  it('keeps the pending and active threads, each title on one line', () => {
    const { threads } = buildChapterContext({
      entries: ENTRIES,
      previousChapterSummary: null,
      threads: THREADS,
      mode: 'adventure',
      ...NO_LEAD,
    })
    expect(threads).toEqual([
      { title: 'Find the heir', status: 'active' },
      { title: 'The debt to the guild', status: 'pending' },
    ])
  })

  it("carries the story's mode", () => {
    for (const mode of ['adventure', 'creative'] as const) {
      expect(
        buildChapterContext({
          entries: ENTRIES,
          previousChapterSummary: null,
          threads: [],
          mode,
          ...NO_LEAD,
        }).mode,
      ).toBe(mode)
    }
  })

  it("carries the previous chapter's summary, or null for a branch's first", () => {
    expect(
      buildChapterContext({
        entries: ENTRIES,
        previousChapterSummary: SUMMARY,
        threads: [],
        mode: 'adventure',
        ...NO_LEAD,
      }).previousChapterSummary,
    ).toBe(SUMMARY)
    expect(
      buildChapterContext({
        entries: ENTRIES,
        previousChapterSummary: null,
        threads: [],
        mode: 'adventure',
        ...NO_LEAD,
      }).previousChapterSummary,
    ).toBeNull()
  })

  it('renders the chapter, the one before it and the open threads in the user half alone', () => {
    const { system, user } = renderTemplate(
      TEMPLATE_IDS.chapterMetadata,
      buildChapterContext({
        entries: ENTRIES,
        previousChapterSummary: SUMMARY,
        threads: THREADS,
        mode: 'adventure',
        ...NO_LEAD,
      }),
    )
    expect(user).toContain(`# The previous chapter\n${SUMMARY}`)
    expect(user).toContain('- Find the heir (active)\n- The debt to the guild (pending)')
    expect(user).not.toContain('The lost map')
    expect(user).not.toContain('Warn the abbey')
    expect(user).toContain('<user_turn>\nI wade in, holding the sigil above my head.\n</user_turn>')
    expect(user).not.toContain('<state>')
    expect(user).not.toContain('entry_close_')
    expect(system).not.toContain(SUMMARY)
    expect(system).not.toContain('Find the heir')
    expect(system).toContain('<user_turn>')
  })

  it('tells the model a pending thread is known but not yet pursued', () => {
    const { system } = renderTemplate(
      TEMPLATE_IDS.chapterMetadata,
      buildChapterContext({
        entries: ENTRIES,
        previousChapterSummary: null,
        threads: THREADS,
        mode: 'adventure',
        ...NO_LEAD,
      }),
    )
    expect(system).toContain('an active thread is one the story is following')
    expect(system).toContain('a pending one is known to the story but not yet pursued')
    expect(system).toContain('Name a thread in the summary only when this chapter moves it')
  })

  it('leaves out the previous chapter and the threads when there are none', () => {
    const { user } = renderTemplate(
      TEMPLATE_IDS.chapterMetadata,
      buildChapterContext({
        entries: ENTRIES,
        previousChapterSummary: null,
        threads: [],
        mode: 'adventure',
        ...NO_LEAD,
      }),
    )
    expect(user).not.toContain('# The previous chapter')
    expect(user).not.toContain('# Open threads')
    // The opener is the mock's marker for this call (scripts/mock-llm/shapes.ts → markerOf).
    expect(
      user.startsWith(
        'Give this chapter its title, summary, theme and keywords.\n\n# The narration\nThe chapter is narrated in the second person.\n\n# The chapter\n',
      ),
    ).toBe(true)
  })

  // A creative prose turn is part of the story; an adventure's speech stands unless contradicted.
  it("reads a user's turn by the story's mode", () => {
    const creative = renderTemplate(
      TEMPLATE_IDS.chapterMetadata,
      buildChapterContext({
        entries: [
          entry(
            4,
            'user_action',
            'Kael burned the letter before Mora could read it, and rode north.',
          ),
          entry(5, 'ai_reply', 'The road north was empty under a low sky.'),
        ],
        previousChapterSummary: null,
        threads: [],
        mode: 'creative',
        ...NO_LEAD,
      }),
    )
    expect(creative.system).toContain(CREATIVE_TURN_RULE)
    expect(creative.system).toContain('One that reads as prose is part of the story')
    expect(creative.system).not.toContain(ADVENTURE_TURN_RULE)
    expect(creative.user).toContain('<user_turn>\nKael burned the letter')

    const adventure = renderTemplate(
      TEMPLATE_IDS.chapterMetadata,
      buildChapterContext({
        entries: [
          entry(4, 'user_action', 'I tell Mora the heir is dead.'),
          entry(5, 'ai_reply', 'Mora turns away.'),
        ],
        previousChapterSummary: null,
        threads: [],
        mode: 'adventure',
        ...NO_LEAD,
      }),
    )
    expect(adventure.system).toContain(ADVENTURE_TURN_RULE)
    expect(adventure.system).toContain(
      'what the lead says stands unless the narration contradicts it',
    )
    expect(adventure.system).toContain('outside quoted speech, its "I" is the lead')
    expect(adventure.system).not.toContain(CREATIVE_TURN_RULE)
    expect(adventure.user).toContain('<user_turn>\nI tell Mora the heir is dead.\n</user_turn>')
  })
})

// memory/chapter-close.md → Phase 2: the lead by name and the narration; a mark by name alone,
// since the call has no id map.
describe('buildChapterContext — the lead, the narration and the marks', () => {
  const AEFRE = 'char_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const BAEL = 'char_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  const GONE = 'char_99999999-9999-9999-9999-999999999999'
  const NAMES: ReadonlyMap<string, string> = new Map([
    [AEFRE, 'Aefre'],
    [BAEL, 'Bael'],
  ])

  const stamped = (
    position: number,
    kind: CloseRangeEntry['kind'],
    content: string,
    leadId?: string,
  ): CloseRangeEntry => ({
    ...entry(position, kind, content),
    metadata: {
      sceneEntities: [],
      currentLocationId: null,
      worldTime: position,
      ...(leadId === undefined ? {} : { leadId }),
    },
  })

  const build = (
    entries: readonly CloseRangeEntry[],
    lead: { id: string; name: string } | null = { id: BAEL, name: 'Bael' },
  ) =>
    buildChapterContext({
      entries,
      previousChapterSummary: null,
      threads: [],
      mode: 'adventure',
      lead,
      narration: 'first',
      nameOf: (id) => NAMES.get(id),
    })

  // Aefre's run, then Bael's, Bael the lead.
  const SWITCHED = [
    stamped(1, 'opening', 'The gate groans open.', AEFRE),
    stamped(2, 'user_action', 'I step into the yard.', AEFRE),
    stamped(3, 'ai_reply', 'The yard is silent.', BAEL),
    stamped(4, 'user_action', 'I bar the gate behind me.', BAEL),
  ]

  it('carries the lead by name alone, null with none, and the narration', () => {
    expect(build(SWITCHED).lead).toEqual({ name: 'Bael' })
    expect(build(SWITCHED, null).lead).toBeNull()
    expect(build(SWITCHED).narration).toBe('first')
  })

  // Absent, not null: an unmarked turn carries no leadMark key at all.
  it('marks no entry when every stamp names the lead', () => {
    const { entries } = build([
      stamped(1, 'ai_reply', 'The yard is silent.', BAEL),
      stamped(2, 'user_action', 'I bar the gate behind me.', BAEL),
    ])
    expect(entries.map((e) => Object.hasOwn(e, 'leadMark'))).toEqual([false, false])
  })

  it("marks each run's first entry by name, with no id", () => {
    const context = build(SWITCHED)
    expect(context.entries.map((e) => e.leadMark)).toEqual([
      { name: 'Aefre' },
      undefined,
      { name: 'Bael' },
      undefined,
    ])
    expect(JSON.stringify(context)).not.toContain('char_')
  })

  // A part's call builds its own context: the walk restarts from the lead at each part, so a part
  // opening under Aefre is marked though the part before it ended under Aefre too.
  it('walks a part on its own, marking a part that opens under a former lead', () => {
    expect(build(SWITCHED.slice(1)).entries.map((e) => e.leadMark)).toEqual([
      { name: 'Aefre' },
      { name: 'Bael' },
      undefined,
    ])
  })

  it('marks a deleted character as gone and an unstamped run as having no lead', () => {
    const { entries } = build([
      stamped(1, 'ai_reply', 'A stranger speaks.', GONE),
      stamped(2, 'user_action', 'I answer him.'),
      stamped(3, 'ai_reply', 'The yard is silent.', BAEL),
    ])
    expect(entries.map((e) => e.leadMark)).toEqual([
      { gone: true },
      { none: true },
      { name: 'Bael' },
    ])
  })

  it('renders the narration and the lead in the user half, before the turns', () => {
    const { system, user } = renderTemplate(
      TEMPLATE_IDS.chapterMetadata,
      build([stamped(1, 'ai_reply', 'The yard is silent.', BAEL)]),
    )
    expect(user).toContain(
      '# The narration\nThe chapter is narrated in the first person.\nThe story\'s lead is Bael. Outside quoted speech, "I" and "you" in the turns are the lead.\n\n# The chapter\n\nThe yard is silent.',
    )
    expect(system).not.toContain('Bael')
    expect(system).not.toContain('narrated in the first person')
  })

  it('is read by the metadata and part templates, and not by the merge', () => {
    for (const id of [TEMPLATE_IDS.chapterMetadata, TEMPLATE_IDS.chapterMetadataPart]) {
      expect(templateReads(id).has('lead')).toBe(true)
      expect(templateReads(id).has('narration')).toBe(true)
    }
    expect(templateReads(TEMPLATE_IDS.chapterMetadataMerge).has('lead')).toBe(false)
    expect(templateReads(TEMPLATE_IDS.chapterMetadataMerge).has('narration')).toBe(false)
  })
})

describe("a chapter in parts: a part's call and the merge", () => {
  const PART_SUMMARIES = [
    'You wade into the black water with the sigil held high.',
    'On the far bank Mora raises a shuttered lantern.',
  ]

  it("renders a part's entries, the one before it and the open threads in the user half alone", () => {
    const { system, user } = renderTemplate(
      TEMPLATE_IDS.chapterMetadataPart,
      buildChapterContext({
        entries: ENTRIES,
        previousChapterSummary: SUMMARY,
        threads: THREADS,
        mode: 'creative',
        ...NO_LEAD,
      }),
    )
    expect(
      user.startsWith(
        `Summarize this part of the chapter.\n\n# The previous chapter\n${SUMMARY}\n\n# Open threads\n`,
      ),
    ).toBe(true)
    expect(user).toContain('# This part of the chapter\n\nThe marsh road ended at a wall')
    expect(user).toContain('<user_turn>\nI wade in, holding the sigil above my head.\n</user_turn>')
    expect(user).not.toContain('<state>')
    expect(user).not.toContain('The lost map')
    expect(system).toContain(CREATIVE_TURN_RULE)
    expect(system).toContain('Summarize this part alone')
    expect(system).toContain('Name a thread in the summary only when this part moves it')
    expect(system).not.toContain(SUMMARY)
    expect(system).not.toContain('Find the heir')
  })

  it('emits exactly what the merge template reads: the summaries, the prior summary and the threads', () => {
    const context = buildChapterMergeContext({
      partSummaries: PART_SUMMARIES,
      previousChapterSummary: null,
      threads: [],
    })
    expect(Object.keys(context).sort()).toEqual([
      'partSummaries',
      'previousChapterSummary',
      'threads',
    ])
    expect([...templateReads(TEMPLATE_IDS.chapterMetadataMerge)].sort()).toEqual([
      'partSummaries',
      'previousChapterSummary',
      'threads',
    ])
  })

  it('keeps the pending and active threads for the merge, each title on one line', () => {
    expect(
      buildChapterMergeContext({
        partSummaries: PART_SUMMARIES,
        previousChapterSummary: SUMMARY,
        threads: THREADS,
      }),
    ).toEqual({
      partSummaries: PART_SUMMARIES,
      previousChapterSummary: SUMMARY,
      threads: [
        { title: 'Find the heir', status: 'active' },
        { title: 'The debt to the guild', status: 'pending' },
      ],
    })
  })

  it('renders the summaries in order, the one before them and the open threads in the user half alone', () => {
    const { system, user } = renderTemplate(
      TEMPLATE_IDS.chapterMetadataMerge,
      buildChapterMergeContext({
        partSummaries: PART_SUMMARIES,
        previousChapterSummary: SUMMARY,
        threads: THREADS,
      }),
    )
    expect(
      user.startsWith(
        `Give the chapter its title, summary, theme and keywords from the summaries of its parts.\n\n# The previous chapter\n${SUMMARY}\n\n`,
      ),
    ).toBe(true)
    expect(user).toContain('- Find the heir (active)\n- The debt to the guild (pending)')
    expect(user).toContain(
      `# The chapter's parts\n\n## Part 1\n${PART_SUMMARIES[0]}\n\n## Part 2\n${PART_SUMMARIES[1]}`,
    )
    expect(system).toContain('- Title. A few words naming the chapter')
    expect(system).toContain('Two to four sentences telling what happened across the whole chapter')
    expect(system).not.toContain(PART_SUMMARIES[0])
    expect(system).not.toContain(SUMMARY)
    expect(system).not.toContain('<user_turn>')
  })
})

const HANDLES: Readonly<Record<string, string>> = {
  entry_close_1: 't1',
  entry_close_2: 't2',
  entry_close_3: 't3',
}
const handleOf = (entryId: string): string | undefined => HANDLES[entryId]

// ENTRIES carry no lead stamp (`metadata: null`), so walked from no lead they get no mark.
const CLOSE_UNMARKED = {
  namedLeadId: null,
  nameOf: (): string | undefined => undefined,
  show: (): string => {
    throw new Error('no turn of ENTRIES is marked')
  },
}

describe('buildCloseTurns', () => {
  it("puts each entry's prose under its turn handle, in order", () => {
    expect(buildCloseTurns(ENTRIES, handleOf, CLOSE_UNMARKED)).toEqual([
      {
        handle: 't1',
        kind: 'opening',
        content: 'The marsh road ended at a wall of black water, and the keep stood beyond it.',
      },
      { handle: 't2', kind: 'user_action', content: 'I wade in, holding the sigil above my head.' },
      {
        handle: 't3',
        kind: 'ai_reply',
        content: 'The cold takes your breath. On the far bank Mora raises a shuttered lantern.',
      },
    ])
  })

  it('refuses an entry with no turn handle', () => {
    expect(() =>
      buildCloseTurns(
        ENTRIES,
        (id) => (id === 'entry_close_3' ? undefined : handleOf(id)),
        CLOSE_UNMARKED,
      ),
    ).toThrow('entry_close_3')
  })

  // A close task's render sets the close-only key; the prose macro must read it in this shape.
  it('feeds the prose macro under the close-only variable', () => {
    const probe = 'tmpl_close_prose_probe'
    const { engine } = loadPack({
      ...bundledPack,
      templates: {
        ...bundledPack.templates,
        [probe]: {
          group: 'chapter',
          system: `{% include '${MACRO_IDS.closeProse}' %}`,
          user: 'Begin.',
        },
      },
    })
    const [key] = CLOSE_ONLY_CHAPTER_VARIABLES

    const { system } = renderWith(engine, probe, {
      [key]: buildCloseTurns(ENTRIES, handleOf, CLOSE_UNMARKED),
    })

    expect(system).toBe(
      [
        '# The turns',
        '',
        '## t1 (the opening)',
        'The marsh road ended at a wall of black water, and the keep stood beyond it.',
        '',
        "## t2 (the user's turn)",
        '<user_turn>',
        'I wade in, holding the sigil above my head.',
        '</user_turn>',
        '',
        '## t3 (narration)',
        'The cold takes your breath. On the far bank Mora raises a shuttered lantern.',
      ].join('\n'),
    )
  })
})

// architecture.md → System and user halves: a close's turns mark where the lead changes; the
// marked character takes the handle `show` gives it as the turns are built.
describe('buildCloseTurns → lead marks', () => {
  const ARIA = 'char_00000000-0000-4000-8000-0000000000a1'
  const WREN = 'char_00000000-0000-4000-8000-0000000000b1'
  const GONE = 'char_00000000-0000-4000-8000-0000000000f1'
  const NAMES: Readonly<Record<string, string>> = { [ARIA]: 'Aria', [WREN]: 'Wren' }
  const nameOf = (id: string): string | undefined => NAMES[id]

  // ENTRIES, each stamped with its lead; undefined leaves one unstamped.
  const stampedAs = (stamps: readonly (string | undefined)[]): CloseRangeEntry[] =>
    ENTRIES.map((entry, i) => {
      const leadId = stamps[i]
      return {
        ...entry,
        metadata: {
          sceneEntities: [],
          currentLocationId: null,
          worldTime: 0,
          ...(leadId === undefined ? {} : { leadId }),
        },
      }
    })

  // Hands c1, c2… in first-call order, as a close's id map does, and records each call.
  function recordingShow() {
    const calls: [string, string][] = []
    const handles = new Map<string, string>()
    const show = (id: string, name: string): string => {
      calls.push([id, name])
      const handle = handles.get(id) ?? `c${handles.size + 1}`
      handles.set(id, handle)
      return handle
    }
    return { calls, show }
  }

  it("marks no turn when every stamp is the named lead's, and shows no character", () => {
    const { calls, show } = recordingShow()

    const turns = buildCloseTurns(stampedAs([WREN, WREN, WREN]), handleOf, {
      namedLeadId: WREN,
      nameOf,
      show,
    })

    expect(turns.map((turn) => 'leadMark' in turn)).toEqual([false, false, false])
    expect(calls).toEqual([])
  })

  it('marks the first turn of each run, its character under the handle show gives it', () => {
    const { calls, show } = recordingShow()

    const turns = buildCloseTurns(stampedAs([ARIA, WREN, WREN]), handleOf, {
      namedLeadId: WREN,
      nameOf,
      show,
    })

    expect(turns).toEqual([
      {
        handle: 't1',
        kind: 'opening',
        content: 'The marsh road ended at a wall of black water, and the keep stood beyond it.',
        leadMark: { id: 'c1', name: 'Aria' },
      },
      {
        handle: 't2',
        kind: 'user_action',
        content: 'I wade in, holding the sigil above my head.',
        leadMark: { id: 'c2', name: 'Wren' },
      },
      {
        handle: 't3',
        kind: 'ai_reply',
        content: 'The cold takes your breath. On the far bank Mora raises a shuttered lantern.',
      },
    ])
    expect('leadMark' in turns[2]!).toBe(false)
    expect(calls).toEqual([
      [ARIA, 'Aria'],
      [WREN, 'Wren'],
    ])
  })

  it('marks a run under a character the branch no longer holds as gone, and shows it no handle', () => {
    const { calls, show } = recordingShow()

    const turns = buildCloseTurns(stampedAs([GONE, GONE, WREN]), handleOf, {
      namedLeadId: WREN,
      nameOf,
      show,
    })

    expect(turns.map((turn) => turn.leadMark)).toEqual([
      { gone: true },
      undefined,
      { id: 'c1', name: 'Wren' },
    ])
    expect(calls).toEqual([[WREN, 'Wren']])
  })

  it('marks a run with no stamp as having no lead', () => {
    const { calls, show } = recordingShow()

    const turns = buildCloseTurns(stampedAs([undefined, WREN, WREN]), handleOf, {
      namedLeadId: WREN,
      nameOf,
      show,
    })

    expect(turns.map((turn) => turn.leadMark)).toEqual([
      { none: true },
      { id: 'c1', name: 'Wren' },
      undefined,
    ])
    expect(calls).toEqual([[WREN, 'Wren']])
  })
})
