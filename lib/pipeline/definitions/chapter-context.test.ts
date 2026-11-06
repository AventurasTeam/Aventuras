import { describe, expect, it } from 'vitest'

import type { Thread, ThreadStatus } from '@/lib/db'
import { renderTemplate, TEMPLATE_IDS, templateReads, VARIABLES } from '@/lib/prompts'

import { buildChapterContext, type CloseRangeEntry } from './chapter-context'

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

// Each mode's paragraph on reading a user's turn (ui/principles.md → Mode), as the system says it.
const ADVENTURE_TURN_RULE = 'Each is what the lead does, says or attempts'
const CREATIVE_TURN_RULE = 'Each is a direction or prose'

describe('buildChapterContext', () => {
  it('emits exactly the variables pinned for the chapter group, nothing more', () => {
    const context = buildChapterContext({
      entries: ENTRIES,
      previousChapterSummary: null,
      threads: [],
      mode: 'adventure',
    })
    const declared = VARIABLES.chapter.map((v) => v.name)
    expect(Object.keys(context).sort()).toEqual([...declared].sort())
  })

  it('is what the metadata template reads, and all of it', () => {
    const declared = VARIABLES.chapter.map((v) => v.name)
    expect([...templateReads(TEMPLATE_IDS.chapterMetadata)].sort()).toEqual([...declared].sort())
  })

  // A row written before the write-path strip still carries its trailing block, and an entry id
  // would leak raw: `entry_` doesn't substitute.
  it('projects each entry to its position, kind and prose', () => {
    const { entries } = buildChapterContext({
      entries: ENTRIES,
      previousChapterSummary: null,
      threads: [],
      mode: 'adventure',
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
    })
    expect(threads).toEqual([
      { title: 'Find the heir', status: 'active' },
      { title: 'The debt to the guild', status: 'pending' },
    ])
  })

  it("carries the story's mode", () => {
    for (const mode of ['adventure', 'creative'] as const) {
      expect(
        buildChapterContext({ entries: ENTRIES, previousChapterSummary: null, threads: [], mode })
          .mode,
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
      }).previousChapterSummary,
    ).toBe(SUMMARY)
    expect(
      buildChapterContext({
        entries: ENTRIES,
        previousChapterSummary: null,
        threads: [],
        mode: 'adventure',
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

  it('leaves out the previous chapter and the threads when there are none', () => {
    const { user } = renderTemplate(
      TEMPLATE_IDS.chapterMetadata,
      buildChapterContext({
        entries: ENTRIES,
        previousChapterSummary: null,
        threads: [],
        mode: 'adventure',
      }),
    )
    expect(user).not.toContain('# The previous chapter')
    expect(user).not.toContain('# Open threads')
    expect(user.startsWith('# The chapter\n')).toBe(true)
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
