import { describe, expect, it } from 'vitest'
import { AskedQuestion, type Question } from './askedQuestion'

class Plain extends AskedQuestion {
  current: Question | null = null
}

const discard: Question = { title: 'Discard?', description: 'It will be lost.' }

describe('AskedQuestion', () => {
  it('resolves with the answer and clears the question', async () => {
    const question = new Plain()
    const asked = question.ask(discard)
    expect(question.open).toBe(true)
    question.answer(true)
    await expect(asked).resolves.toBe(true)
    expect(question.current).toBeNull()
  })

  it('answers no to an attempt made while a question is up, keeping the first', async () => {
    const question = new Plain()
    const first = question.ask(discard)
    await expect(question.ask({ ...discard, title: 'Other?' })).resolves.toBe(false)
    expect(question.current?.title).toBe('Discard?')
    question.answer(false)
    await expect(first).resolves.toBe(false)
  })

  it('ignores an answer when nothing is asked', () => {
    const question = new Plain()
    expect(() => question.answer(true)).not.toThrow()
    expect(question.open).toBe(false)
  })
})
