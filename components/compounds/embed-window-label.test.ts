import { describe, expect, it } from 'vitest'

import { counterLabel } from './embed-window-label'

const at = (tokens: number | null, over: boolean, exact: boolean, window: number | null = 512) => ({
  tokens,
  exact,
  window: { tokens: window, source: 'catalog' as const },
  pressure: (over ? 'over' : 'near') as 'over' | 'near',
})

describe('counterLabel', () => {
  it('says nothing before the first count settles', () => {
    expect(counterLabel(at(null, false, true))).toBeNull()
  })

  // A custom import establishes no ceiling, so `240 / ?` has no second half.
  it('says nothing when the window is unknown, however long the text', () => {
    expect(counterLabel(at(9000, true, true, null))).toBeNull()
  })

  it('reports an exact count plainly', () => {
    expect(counterLabel(at(400, false, true))).toEqual({
      key: 'embedder:inputWindow.count',
      values: { tokens: 400, window: 512 },
    })
  })

  // The estimate is a different tokenizer against a guessed ceiling; rendering it
  // like a measurement would launder a guess.
  it('marks an estimated count as approximate', () => {
    expect(counterLabel(at(400, false, false))?.key).toBe('embedder:inputWindow.countApprox')
  })

  it('switches to the over-window string once past the ceiling', () => {
    expect(counterLabel(at(600, true, true))?.key).toBe('embedder:inputWindow.over')
  })

  it('keeps the approximate marking past the ceiling too', () => {
    expect(counterLabel(at(600, true, false))?.key).toBe('embedder:inputWindow.overApprox')
  })
})

// A user action is a query, not a stored document: overrunning searches memory on
// the prefix and the next turn asks again, so it must not claim the text became
// permanently unsearchable the way a lore body does.
describe('counterLabel — query variant', () => {
  it('uses the query wording past the window', () => {
    expect(counterLabel(at(600, true, true), 'query')?.key).toBe('embedder:inputWindow.queryOver')
  })

  it('keeps the approximate marking on the query wording', () => {
    expect(counterLabel(at(600, true, false), 'query')?.key).toBe(
      'embedder:inputWindow.queryOverApprox',
    )
  })

  // Under the window both variants say the same thing — the difference is only in
  // what overrunning costs.
  it('shares the plain count with the document variant', () => {
    expect(counterLabel(at(400, false, true), 'query')?.key).toBe('embedder:inputWindow.count')
  })

  it('defaults to the document wording when no variant is given', () => {
    expect(counterLabel(at(600, true, true))?.key).toBe('embedder:inputWindow.over')
  })
})
