import { describe, expect, it } from 'vitest'

import { templateGlobals } from '../engine'
import { bundledPack, loadPack, renderTemplate, TEMPLATE_IDS, templateReads } from '../index'
import { BOUNDARY_ONLY_CHAPTER_VARIABLES } from '../templateContextMap'

const CONTEXT = {
  boundaryCandidates: [
    {
      turn: 't1',
      position: 61,
      opening: 'The rain stopped at dusk.',
      closing: 'Mora lit the lamp.',
    },
    { turn: 't2', position: 65, opening: 'Nobody came to the ford.', closing: null },
  ],
  boundaryLengthFrom: 2000,
  boundaryLengthTo: 6000,
  boundaryActiveThreads: [{ title: 'Find the heir' }, { title: 'The debt to the guild' }],
}

// chapter-close.md → Phase 1.
describe('bundled chapter-boundary template', () => {
  // C3: boundary follows the normal rule, so its system half reads nothing at all.
  it('reads nothing in its system half, and only the boundary-only variables in all', () => {
    const { engine } = loadPack(bundledPack)
    expect([...templateGlobals(engine, TEMPLATE_IDS.chapterBoundary, 'system')]).toEqual([])
    expect([...templateReads(TEMPLATE_IDS.chapterBoundary)].sort()).toEqual(
      [...BOUNDARY_ONLY_CHAPTER_VARIABLES].sort(),
    )
  })

  it("names canon's natural endings, and asks for one listed turn id and one sentence", () => {
    const { system } = renderTemplate(TEMPLATE_IDS.chapterBoundary, CONTEXT)
    expect(system).toContain(
      'a scene changes, time skips ahead, a beat of its arc resolves, or the narrative pauses',
    )
    expect(system).toContain('Answer with the turn id of one listed turn, exactly as it is shown.')
    expect(system).toContain('Give one sentence on why the chapter ends there.')
  })

  // The scene-opener guard is one fact; the old step-by-step rule (end on the turn before, else choose
  // among the others) cost a run its whole budget, so it stays out.
  it('states a scene-opening turn begins the next chapter in one sentence, with no procedure', () => {
    const { system } = renderTemplate(TEMPLATE_IDS.chapterBoundary, CONTEXT)
    expect(system).toContain(
      "Pick the turn where the story comes to a natural ending: a scene changes, time skips ahead, a beat of its arc resolves, or the narrative pauses. A turn that opens on a new scene or after a time skip begins the next chapter, so it can't end this one. The active threads, when listed, help tell where an arc beat resolves.",
    )
    expect(system).not.toContain('the next chapter opens')
    expect(system).not.toContain('end on the listed turn before it')
  })

  it('shows the length range, the active threads, and each candidate by turn id, position and sentences', () => {
    expect(renderTemplate(TEMPLATE_IDS.chapterBoundary, CONTEXT).user).toBe(
      [
        'Pick the turn this chapter ends on.',
        '',
        '# The open chapter',
        'Each turn listed would end this chapter between 2000 and 6000 tokens long, all good lengths for a chapter, so choose by the story alone.',
        '',
        '# Active threads',
        '- Find the heir',
        '- The debt to the guild',
        '',
        '# Candidate turns',
        '',
        '## t1 (position 61)',
        'Opens: The rain stopped at dusk.',
        'Ends: Mora lit the lamp.',
        '',
        '## t2 (position 65)',
        'Opens: Nobody came to the ford.',
      ].join('\n'),
    )
  })

  it('leaves the threads heading out when no thread is active', () => {
    const { user } = renderTemplate(TEMPLATE_IDS.chapterBoundary, {
      ...CONTEXT,
      boundaryActiveThreads: [],
    })
    expect(user).not.toContain('# Active threads')
    expect(user).toContain(
      'between 2000 and 6000 tokens long, all good lengths for a chapter, so choose by the story alone.\n\n# Candidate turns',
    )
  })
})
