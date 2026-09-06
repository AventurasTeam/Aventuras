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
    expect(s.q1.text).toBe('I draw the blade and wait.')
    expect(s.presence[0]).toBe(true)
  })

  it('trims surrounding whitespace off the user action', () => {
    const s = buildQueryStack({ ...base, userAction: '  I draw the blade.\n' })
    expect(s.q1.text).toBe('I draw the blade.')
  })

  it('builds Q2 from the structural template', () => {
    const s = buildQueryStack(base)
    expect(s.q2.text).toBe(
      'Kara Vex, Mira, The Hollow.\nActive threads: Find the courier.\nEra: Third Age.',
    )
  })

  it('joins multiple scene entities and threads with commas', () => {
    const s = buildQueryStack({
      ...base,
      activeThreadTitles: ['Find the courier', 'Repay the debt'],
    })
    expect(s.q2.text).toContain('Kara Vex, Mira')
    expect(s.q2.text).toContain('Active threads: Find the courier, Repay the debt.')
  })

  it('drops the location from the scene line when there is none', () => {
    const s = buildQueryStack({ ...base, currentLocationName: null })
    expect(s.q2.text.split('\n')[0]).toBe('Kara Vex, Mira.')
  })

  it('opens the scene line with the location when there are no entities', () => {
    const s = buildQueryStack({ ...base, sceneEntityNames: [] })
    expect(s.q2.text.split('\n')[0]).toBe('The Hollow.')
  })

  it('drops the scene line entirely when there are neither entities nor a location', () => {
    const s = buildQueryStack({ ...base, sceneEntityNames: [], currentLocationName: null })
    expect(s.q2.text).toBe('Active threads: Find the courier.\nEra: Third Age.')
  })

  it('skips blank entity names and thread titles rather than rendering bare commas', () => {
    const s = buildQueryStack({
      ...base,
      sceneEntityNames: ['Kara Vex', '', '   ', 'Mira'],
      activeThreadTitles: ['', '  ', 'Find the courier'],
    })
    expect(s.q2.text).toBe(
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
    expect(s.q2.text).toBe(
      'Kara Vex, Mira, The Hollow.\nActive threads: Find the courier.\nEra: Third Age.',
    )
  })

  it('drops a whitespace-only location from the scene line', () => {
    const s = buildQueryStack({ ...base, currentLocationName: '   ' })
    expect(s.q2.text.split('\n')[0]).toBe('Kara Vex, Mira.')
  })

  it('drops the threads line entirely when no thread is active', () => {
    const s = buildQueryStack({ ...base, activeThreadTitles: [] })
    expect(s.q2.text).toBe('Kara Vex, Mira, The Hollow.\nEra: Third Age.')
  })

  it('drops the era line entirely when there is no era', () => {
    const s = buildQueryStack({ ...base, eraName: null })
    expect(s.q2.text).toBe('Kara Vex, Mira, The Hollow.\nActive threads: Find the courier.')
  })

  it('treats a blank or whitespace-only era the same as a missing one', () => {
    const expected = 'Kara Vex, Mira, The Hollow.\nActive threads: Find the courier.'
    expect(buildQueryStack({ ...base, eraName: '' }).q2.text).toBe(expected)
    expect(buildQueryStack({ ...base, eraName: '   ' }).q2.text).toBe(expected)
  })

  it('makes the piggyback summary Q3 rather than a line of the digest', () => {
    const s = buildQueryStack({ ...base, piggybackSummary: 'Aria fled into the marshes.' })
    expect(s.q3.text).toBe('Aria fled into the marshes.')
    expect(s.q3.source).toBe('piggyback_summary')
    // The digest is structural only now — the summary sharing its vector was the
    // whole reason it split out (retrieval.md → Why it is not part of Q2).
    expect(s.q2.text).not.toContain('Aria fled into the marshes.')
  })

  it('marks Q3 absent when no summary was written', () => {
    const s = buildQueryStack({ ...base, piggybackSummary: null })
    expect(s.q3.text).toBe('')
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
    expect(s.q2.text).toBe('')
    expect(s.presence).toEqual([true, false, true])
    expect(s.embedTexts).toEqual([s.q1.text, s.q3.text])
  })

  it('marks Q2 absent when every structural field is whitespace only', () => {
    const s = buildQueryStack({
      ...base,
      sceneEntityNames: ['   '],
      currentLocationName: '  ',
      activeThreadTitles: ['\t'],
      eraName: '   ',
    })
    expect(s.q2.text).toBe('')
    expect(s.presence[1]).toBe(false)
  })

  it('keeps a partially populated Q2 present without an empty threads line', () => {
    const s = buildQueryStack({
      ...base,
      activeThreadTitles: [],
      eraName: null,
    })
    expect(s.q2.text).toBe('Kara Vex, Mira, The Hollow.')
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
    expect([s.q1.source, s.q2.source, s.q3.source]).toEqual([
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
    expect(s.embedTexts).toEqual([s.q2.text, s.q3.text])
  })

  it('lists all three as embed inputs when all three are present', () => {
    const s = buildQueryStack({ ...base, piggybackSummary: 'Aria fled into the marshes.' })
    expect(s.embedTexts).toEqual([s.q1.text, s.q2.text, s.q3.text])
  })

  it('omits an absent Q3 from the embed inputs', () => {
    const s = buildQueryStack(base)
    expect(s.embedTexts).toEqual([s.q1.text, s.q2.text])
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

  it('discards vectors beyond the present slots', () => {
    expect(distributeQueryVectors([v(1), v(2), v(3)], [true, false, false])).toEqual([
      v(1),
      null,
      null,
    ])
  })
})
