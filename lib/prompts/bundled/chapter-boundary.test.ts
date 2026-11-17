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
  boundaryRegionTokens: 6150,
  boundaryThreshold: 4000,
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

  it('shows the length, the active threads, and each candidate by turn id, position and sentences', () => {
    expect(renderTemplate(TEMPLATE_IDS.chapterBoundary, CONTEXT).user).toBe(
      [
        'Pick the turn this chapter ends on.',
        '',
        '# The open chapter',
        '6150 tokens so far; a chapter runs about 4000 tokens.',
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
      '6150 tokens so far; a chapter runs about 4000 tokens.\n\n# Candidate turns',
    )
  })
})
