import { describe, expect, it } from 'vitest'

import { buildQueryStack, distributeQueryVectors, type QueryStackInput } from './queries'

const index = {
  entityNames: new Set(['kara vex']),
  loreKeywords: new Set<string>(),
}

const base: QueryStackInput = {
  userAction: 'I draw the blade and wait.',
  sceneEntityNames: ['Kara Vex', 'Mira'],
  currentLocationName: 'The Hollow',
  activeThreadTitles: ['Find the courier'],
  eraName: 'Third Age',
  piggybackSummary: null,
  lastNarrativeContent: 'Kara Vex drew the blade. The awning had not been lowered.',
  index,
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

  it('drops the era line entirely when there is no era', () => {
    const s = buildQueryStack({ ...base, eraName: null })
    expect(s.q2.text).toBe('Kara Vex, Mira, The Hollow.\nActive threads: Find the courier.')
  })

  it('appends the piggyback summary to Q2 when the trailing block parsed', () => {
    const s = buildQueryStack({ ...base, piggybackSummary: 'They agree to split up.' })
    expect(s.q2.text.split('\n').at(-1)).toBe('They agree to split up.')
  })

  it('stands the structural template alone when the summary is absent', () => {
    const s = buildQueryStack(base)
    expect(s.q2.text.trim().endsWith('.')).toBe(true)
    expect(s.q2.text).not.toContain('They agree to split up.')
    expect(s.presence[1]).toBe(true)
  })

  it('derives Q3 from the last narrative entry and carries sentence scores', () => {
    const s = buildQueryStack(base)
    expect(s.q3.text).toContain('Kara Vex')
    expect(s.q3.sentenceScores).toHaveLength(2)
  })

  it('keeps only the top-K sentences rather than the whole narrative entry', () => {
    const lastNarrativeContent = [
      'Kara Vex drew the blade.',
      'The awning sagged.',
      'A cart creaked somewhere behind the stalls.',
      'Dust settled on the sill.',
      'The lamps were unlit and the shutters stayed closed all morning, which nobody in the row of houses remarked upon.',
    ].join(' ')
    const s = buildQueryStack({ ...base, lastNarrativeContent })
    expect(s.q3.sentenceScores).toHaveLength(5)
    expect(s.q3.text).toContain('Kara Vex drew the blade.')
    expect(s.q3.text).not.toContain('The lamps were unlit')
  })

  it('marks Q3 absent on a cold start with no prior narrative', () => {
    const s = buildQueryStack({ ...base, lastNarrativeContent: '' })
    expect(s.presence).toEqual([true, true, false])
    expect(s.q3.text).toBe('')
  })

  it('marks Q1 absent on a blank user action', () => {
    const s = buildQueryStack({ ...base, userAction: '   ' })
    expect(s.presence).toEqual([false, true, true])
  })

  it('always keeps Q2 present — the structural fields are computed, never missing', () => {
    const s = buildQueryStack({
      ...base,
      sceneEntityNames: [],
      currentLocationName: null,
      activeThreadTitles: [],
      eraName: null,
    })
    expect(s.presence[1]).toBe(true)
  })

  it('labels each query with its probe-capture source', () => {
    const s = buildQueryStack(base)
    expect([s.q1.source, s.q2.source, s.q3.source]).toEqual([
      'user_action',
      'structural_digest',
      'prose_extract',
    ])
  })

  it('lists exactly the present queries as embed inputs, in Q1/Q2/Q3 order', () => {
    const s = buildQueryStack({ ...base, userAction: '' })
    expect(s.embedTexts).toEqual([s.q2.text, s.q3.text])
  })

  it('lists all three as embed inputs when all three are present', () => {
    const s = buildQueryStack(base)
    expect(s.embedTexts).toEqual([s.q1.text, s.q2.text, s.q3.text])
  })

  it('omits an absent Q3 from the embed inputs', () => {
    const s = buildQueryStack({ ...base, lastNarrativeContent: '' })
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
})
