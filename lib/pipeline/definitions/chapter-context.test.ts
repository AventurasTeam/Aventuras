import { describe, expect, it } from 'vitest'

import type { StoryEntry, Thread, ThreadStatus } from '@/lib/db'
import { renderTemplate, TEMPLATE_IDS, templateReads, VARIABLES } from '@/lib/prompts'

import { buildChapterContext } from './chapter-context'

function entry(position: number, kind: StoryEntry['kind'], content: string): StoryEntry {
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

describe('buildChapterContext', () => {
  it('emits exactly the variables pinned for the chapter group, nothing more', () => {
    const context = buildChapterContext({
      entries: ENTRIES,
      previousChapterSummary: null,
      threads: [],
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
    })
    expect(threads).toEqual([
      { title: 'Find the heir', status: 'active' },
      { title: 'The debt to the guild', status: 'pending' },
    ])
  })

  it("carries the previous chapter's summary, or null for a branch's first", () => {
    expect(
      buildChapterContext({ entries: ENTRIES, previousChapterSummary: SUMMARY, threads: [] })
        .previousChapterSummary,
    ).toBe(SUMMARY)
    expect(
      buildChapterContext({ entries: ENTRIES, previousChapterSummary: null, threads: [] })
        .previousChapterSummary,
    ).toBeNull()
  })

  it('renders the chapter, the one before it and the open threads in the user half alone', () => {
    const { system, user } = renderTemplate(
      TEMPLATE_IDS.chapterMetadata,
      buildChapterContext({ entries: ENTRIES, previousChapterSummary: SUMMARY, threads: THREADS }),
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
      buildChapterContext({ entries: ENTRIES, previousChapterSummary: null, threads: [] }),
    )
    expect(user).not.toContain('# The previous chapter')
    expect(user).not.toContain('# Open threads')
    expect(user.startsWith('# The chapter\n')).toBe(true)
  })
})
