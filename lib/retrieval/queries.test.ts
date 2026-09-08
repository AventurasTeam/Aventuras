import { describe, expect, it } from 'vitest'

import { buildQueryStack, distributeQueryVectors, type QueryStackInput } from './queries'

const base: QueryStackInput = {
  userAction: 'I draw the blade and wait.',
  sceneEntityNames: ['Kara Vex', 'Mira'],
  currentLocationName: 'The Hollow',
  activeThreadTitles: ['Find the courier'],
  eraName: 'Third Age',
  piggybackSummary: null,
}

describe('buildQueryStack', () => {
  it('uses the user action verbatim as Q1', () => {
    const s = buildQueryStack(base)
    expect(s.specs[0].text).toBe('I draw the blade and wait.')
    expect(s.presence[0]).toBe(true)
  })

  it('trims surrounding whitespace off the user action', () => {
    const s = buildQueryStack({ ...base, userAction: '  I draw the blade.\n' })
    expect(s.specs[0].text).toBe('I draw the blade.')
  })

  it('builds Q2 from the structural template', () => {
    const s = buildQueryStack(base)
    expect(s.specs[1].text).toBe(
      'Kara Vex, Mira, The Hollow.\nActive threads: Find the courier.\nEra: Third Age.',
    )
  })

  it('joins multiple scene entities and threads with commas', () => {
    const s = buildQueryStack({
      ...base,
      activeThreadTitles: ['Find the courier', 'Repay the debt'],
    })
    expect(s.specs[1].text).toContain('Kara Vex, Mira')
    expect(s.specs[1].text).toContain('Active threads: Find the courier, Repay the debt.')
  })

  it('drops the location from the scene line when there is none', () => {
    const s = buildQueryStack({ ...base, currentLocationName: null })
    expect(s.specs[1].text.split('\n')[0]).toBe('Kara Vex, Mira.')
  })

  it('opens the scene line with the location when there are no entities', () => {
    const s = buildQueryStack({ ...base, sceneEntityNames: [] })
    expect(s.specs[1].text.split('\n')[0]).toBe('The Hollow.')
  })

  it('drops the scene line entirely when there are neither entities nor a location', () => {
    const s = buildQueryStack({ ...base, sceneEntityNames: [], currentLocationName: null })
    expect(s.specs[1].text).toBe('Active threads: Find the courier.\nEra: Third Age.')
  })

  it('skips blank entity names and thread titles rather than rendering bare commas', () => {
    const s = buildQueryStack({
      ...base,
      sceneEntityNames: ['Kara Vex', '', '   ', 'Mira'],
      activeThreadTitles: ['', '  ', 'Find the courier'],
    })
    expect(s.specs[1].text).toBe(
      'Kara Vex, Mira, The Hollow.\nActive threads: Find the courier.\nEra: Third Age.',
    )
  })

  it('renders every structural field trimmed', () => {
    const s = buildQueryStack({
      ...base,
      sceneEntityNames: ['  Kara Vex  ', '\tMira'],
      currentLocationName: ' The Hollow\n',
      activeThreadTitles: ['  Find the courier '],
      eraName: '  Third Age  ',
    })
    expect(s.specs[1].text).toBe(
      'Kara Vex, Mira, The Hollow.\nActive threads: Find the courier.\nEra: Third Age.',
    )
  })

  it('drops a whitespace-only location from the scene line', () => {
    const s = buildQueryStack({ ...base, currentLocationName: '   ' })
    expect(s.specs[1].text.split('\n')[0]).toBe('Kara Vex, Mira.')
  })

  it('drops the threads line entirely when no thread is active', () => {
    const s = buildQueryStack({ ...base, activeThreadTitles: [] })
    expect(s.specs[1].text).toBe('Kara Vex, Mira, The Hollow.\nEra: Third Age.')
  })

  it('drops the era line entirely when there is no era', () => {
    const s = buildQueryStack({ ...base, eraName: null })
    expect(s.specs[1].text).toBe('Kara Vex, Mira, The Hollow.\nActive threads: Find the courier.')
  })

  it('treats a blank or whitespace-only era the same as a missing one', () => {
    const expected = 'Kara Vex, Mira, The Hollow.\nActive threads: Find the courier.'
    expect(buildQueryStack({ ...base, eraName: '' }).specs[1].text).toBe(expected)
    expect(buildQueryStack({ ...base, eraName: '   ' }).specs[1].text).toBe(expected)
  })

  it('makes the piggyback summary Q3 rather than a line of the digest', () => {
    const s = buildQueryStack({ ...base, piggybackSummary: 'Aria fled into the marshes.' })
    expect(s.specs[2].text).toBe('Aria fled into the marshes.')
    expect(s.specs[2].source).toBe('piggyback_summary')
    // retrieval.md → Why it is not part of Q2.
    expect(s.specs[1].text).not.toContain('Aria fled into the marshes.')
  })

  it('marks Q3 absent when no summary was written', () => {
    const s = buildQueryStack({ ...base, piggybackSummary: null })
    expect(s.specs[2].text).toBe('')
    expect(s.presence[2]).toBe(false)
    expect(s.embedTexts).not.toContain('')
  })

  it('trims a whitespace-only summary to absent rather than embedding blanks', () => {
    const s = buildQueryStack({ ...base, piggybackSummary: '   \n  ' })
    expect(s.presence[2]).toBe(false)
  })

  it('marks Q1 absent on a blank user action', () => {
    const s = buildQueryStack({ ...base, userAction: '   ' })
    expect(s.presence).toEqual([false, true, false])
  })

  it('marks Q2 absent when every structural field is empty', () => {
    const s = buildQueryStack({
      ...base,
      sceneEntityNames: [],
      currentLocationName: null,
      activeThreadTitles: [],
      eraName: null,
      piggybackSummary: 'Aria fled into the marshes.',
    })
    expect(s.specs[1].text).toBe('')
    expect(s.presence).toEqual([true, false, true])
    expect(s.embedTexts).toEqual([s.specs[0].text, s.specs[2].text])
  })

  it('marks Q2 absent when every structural field is whitespace only', () => {
    const s = buildQueryStack({
      ...base,
      sceneEntityNames: ['   '],
      currentLocationName: '  ',
      activeThreadTitles: ['\t'],
      eraName: '   ',
    })
    expect(s.specs[1].text).toBe('')
    expect(s.presence[1]).toBe(false)
  })

  it('keeps a partially populated Q2 present without an empty threads line', () => {
    const s = buildQueryStack({
      ...base,
      activeThreadTitles: [],
      eraName: null,
    })
    expect(s.specs[1].text).toBe('Kara Vex, Mira, The Hollow.')
    expect(s.presence[1]).toBe(true)
  })

  it('drops every query when the turn carries no signal at all', () => {
    const s = buildQueryStack({
      ...base,
      userAction: '',
      sceneEntityNames: [],
      currentLocationName: null,
      activeThreadTitles: [],
      eraName: null,
    })
    expect(s.presence).toEqual([false, false, false])
    expect(s.embedTexts).toEqual([])
  })

  it('labels each query with its probe-capture source', () => {
    const s = buildQueryStack(base)
    expect(s.specs.map((q) => q.source)).toEqual([
      'user_action',
      'structural_digest',
      'piggyback_summary',
    ])
  })

  it('lists exactly the present queries as embed inputs, in Q1/Q2/Q3 order', () => {
    const s = buildQueryStack({
      ...base,
      userAction: '',
      piggybackSummary: 'Aria fled into the marshes.',
    })
    expect(s.embedTexts).toEqual([s.specs[1].text, s.specs[2].text])
  })

  it('lists all three as embed inputs when all three are present', () => {
    const s = buildQueryStack({ ...base, piggybackSummary: 'Aria fled into the marshes.' })
    expect(s.embedTexts).toEqual([s.specs[0].text, s.specs[1].text, s.specs[2].text])
  })

  it('omits an absent Q3 from the embed inputs', () => {
    const s = buildQueryStack(base)
    expect(s.embedTexts).toEqual([s.specs[0].text, s.specs[1].text])
  })

  it('caps an oversized piggyback summary at the shared query length', () => {
    const long = 'a'.repeat(260)
    const stack = buildQueryStack({ ...base, piggybackSummary: long })

    // Not `.toBe(MAX_QUERY_CHARS)` — deriving the expectation from the constant
    // under test passes against any value it holds. 200 is canon (retrieval.md → Q3).
    expect(stack.specs[2]?.text).toHaveLength(200)
    expect(stack.specs[2]?.text).toBe('a'.repeat(200))
  })

  it('leaves a summary under the cap untouched', () => {
    const summary = 'The courier crossed the marsh under storm light.'
    const stack = buildQueryStack({ ...base, piggybackSummary: summary })

    expect(stack.specs[2]?.text).toBe(summary)
  })

  // Trim before cap, not after: a summary padded to 205 chars by trailing
  // whitespace must yield its 200 content chars, not 200 minus the padding.
  it('trims before capping the summary', () => {
    const stack = buildQueryStack({
      ...base,
      piggybackSummary: `   ${'b'.repeat(210)}   `,
    })

    expect(stack.specs[2]?.text).toBe('b'.repeat(200))
  })
})

describe('emitted Q4 queries', () => {
  it('appends one slot per emitted query, after the fixed three', () => {
    const s = buildQueryStack({ ...base, emittedQueries: ['House Eldrin', 'marsh nobility'] })
    expect(s.specs).toHaveLength(5)
    expect(s.specs.slice(3).map((q) => q.source)).toEqual([
      'classifier_emitted',
      'classifier_emitted',
    ])
    expect(s.slots).toEqual(['action', 'digest', 'summary', 'direct', 'direct'])
  })

  it('deduplicates identical emissions', () => {
    // Three copies would split the pooled weight and cost triple the KNN for one signal.
    const s = buildQueryStack({ ...base, emittedQueries: ['a sigil', 'a sigil', 'a sigil'] })
    expect(s.specs.filter((q) => q.source === 'classifier_emitted')).toHaveLength(1)
  })

  it('drops empty and whitespace-only emissions', () => {
    const s = buildQueryStack({ ...base, emittedQueries: ['', '   ', 'real'] })
    expect(s.specs.filter((q) => q.source === 'classifier_emitted').map((q) => q.text)).toEqual([
      'real',
    ])
  })

  it('caps the emitted set at three', () => {
    const s = buildQueryStack({ ...base, emittedQueries: ['a', 'b', 'c', 'd', 'e'] })
    expect(s.specs.filter((q) => q.source === 'classifier_emitted').map((q) => q.text)).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('does not spend a cap slot on an emission it drops', () => {
    const s = buildQueryStack({ ...base, emittedQueries: ['', 'a', 'b', 'c'] })
    expect(s.specs.filter((q) => q.source === 'classifier_emitted').map((q) => q.text)).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('caps an oversized emission rather than embedding it whole', () => {
    const s = buildQueryStack({ ...base, emittedQueries: ['x'.repeat(500)] })
    expect(s.specs.at(-1)?.text).toBe('x'.repeat(200))
  })

  it('caps before deduplicating, so two oversized emissions can collapse to one', () => {
    const shared = 'x'.repeat(200)
    const s = buildQueryStack({
      ...base,
      emittedQueries: [`${shared} alpha`, `${shared} beta`],
    })
    expect(s.specs.filter((q) => q.source === 'classifier_emitted').map((q) => q.text)).toEqual([
      shared,
    ])
  })

  it('embeds an emitted query and marks its slot present', () => {
    const s = buildQueryStack({ ...base, emittedQueries: ['House Eldrin'] })
    expect(s.presence).toEqual([true, true, false, true])
    expect(s.embedTexts).toEqual([s.specs[0].text, s.specs[1].text, 'House Eldrin'])
  })

  it('records the fixed three even when all are absent, so the probe can render them', () => {
    const s = buildQueryStack({
      ...base,
      userAction: '',
      sceneEntityNames: [],
      currentLocationName: null,
      activeThreadTitles: [],
      eraName: null,
    })
    expect(s.specs.map((q) => q.source)).toEqual([
      'user_action',
      'structural_digest',
      'piggyback_summary',
    ])
    expect(s.embedTexts).toEqual([])
  })
})

const v = (n: number) => Float32Array.from([n])

describe('distributeQueryVectors', () => {
  it('maps vectors onto their slots when all three are present', () => {
    expect(distributeQueryVectors([v(1), v(2), v(3)], [true, true, true])).toEqual([
      v(1),
      v(2),
      v(3),
    ])
  })

  it('lands the first vector in the Q2 slot when Q1 is absent', () => {
    expect(distributeQueryVectors([v(2), v(3)], [false, true, true])).toEqual([null, v(2), v(3)])
  })

  it('leaves the Q3 slot null on a cold start', () => {
    expect(distributeQueryVectors([v(1), v(2)], [true, true, false])).toEqual([v(1), v(2), null])
  })

  it('lands the only vector in the Q2 slot when Q1 and Q3 are both absent', () => {
    expect(distributeQueryVectors([v(2)], [false, true, false])).toEqual([null, v(2), null])
  })

  it('nulls the slots a short vector array cannot fill', () => {
    expect(distributeQueryVectors([v(1)], [true, true, true])).toEqual([v(1), null, null])
  })

  it('follows the presence list past the fixed three', () => {
    expect(distributeQueryVectors([v(1), v(4)], [true, false, false, true])).toEqual([
      v(1),
      null,
      null,
      v(4),
    ])
  })

  it('discards vectors beyond the present slots', () => {
    expect(distributeQueryVectors([v(1), v(2), v(3)], [true, false, false])).toEqual([
      v(1),
      null,
      null,
    ])
  })
})
