import { describe, it, expect, vi } from 'vitest'
import { ChapterQueryBudget } from './chapterQueries'

const budgetOf = (over: Partial<ConstructorParameters<typeof ChapterQueryBudget>[0]> = {}) =>
  new ChapterQueryBudget({
    max: 2,
    scope: 'turn',
    ask: async () => 'an answer',
    ...over,
  })

describe('the budget', () => {
  it('spends one read per new question and refuses past the cap', async () => {
    const budget = budgetOf()

    await budget.ask(1, 'first?')
    await budget.ask(1, 'second?')

    expect(budget.spent).toBe(2)
    expect(budget.exhausted()).toBe(true)
  })

  it('names a cheaper tool only when it was given one', () => {
    expect(budgetOf({ alternative: 'Use grep_chapters instead.' }).exhaustedError()).toContain(
      'grep_chapters',
    )
    // Pointing at a tool that is not registered is the failure this omission avoids.
    expect(budgetOf().exhaustedError()).not.toContain('grep_chapters')
    expect(budgetOf().exhaustedError()).toContain('chapter summaries')
  })
})

describe('the repeat cache', () => {
  it('serves a repeated question without a second read or a second payment', async () => {
    const ask = vi.fn(async () => 'She left at dawn.')
    const budget = budgetOf({ ask })

    const first = await budget.ask(1, 'when did she leave?')
    const again = await budget.ask(1, '  WHEN did  she leave? ')

    expect(ask).toHaveBeenCalledOnce()
    expect(again.answer).toBe(first.answer)
    expect(again.cached).toBe(true)
    expect(budget.spent).toBe(1)
  })

  it('keeps the same question about two chapters apart', async () => {
    const ask = vi.fn(async (n: number) => `answer for ${n}`)
    const budget = budgetOf({ ask })

    await budget.ask(1, 'what happened?')
    await budget.ask(2, 'what happened?')

    expect(ask).toHaveBeenCalledTimes(2)
  })

  it('reports what it already knows, which is what lets a spent budget still answer', async () => {
    const budget = budgetOf()
    await budget.ask(1, 'asked?')

    expect(budget.knows(1, 'ASKED?')).toBe(true)
    expect(budget.knows(1, 'not asked?')).toBe(false)
  })
})

describe('failures', () => {
  it('caches a failure like an answer, so it is not re-asked until the steps run out', async () => {
    const ask = vi.fn(async () => {
      throw new Error('provider down')
    })
    const budget = budgetOf({ ask })

    const first = await budget.ask(1, 'q?')
    const retry = await budget.ask(1, 'q?')

    expect(first.failed).toBe(true)
    expect(first.answer).toContain('provider down')
    expect(retry.answer).toBe(first.answer)
    expect(ask).toHaveBeenCalledOnce()
  })

  it('answers rather than throwing when there is no reader at all', async () => {
    const result = await budgetOf({ ask: undefined }).ask(1, 'q?')

    expect(result.failed).toBe(true)
    expect(result.answer).toContain('not available')
  })
})

describe('the transcript', () => {
  it('records every answer, marking the replays', async () => {
    const records: { cached: boolean; failed: boolean }[] = []
    const budget = budgetOf({ onAnswer: (r) => records.push(r) })

    await budget.ask(1, 'q?')
    await budget.ask(1, 'q?')

    expect(records.map((r) => r.cached)).toEqual([false, true])
    expect(records.every((r) => !r.failed)).toBe(true)
  })
})
