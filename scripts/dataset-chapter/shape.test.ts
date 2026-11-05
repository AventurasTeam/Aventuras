import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { countTokens } from '@/lib/tokens'

import {
  ACTION_MAX_TOKENS,
  actionProblem,
  DATASET_TOKEN_BAND,
  datasetTokens,
  loadShapedDataset,
  paragraphsOf,
  REPLY_TARGET_TOKENS,
  shapeDataset,
  splitReplies,
} from './shape'

const TEXT = readFileSync(
  fileURLToPath(new URL('./treasure-island.txt', import.meta.url).href),
  'utf8',
)

// Prose, not a repeated character: these reach the real counter.
const harbour = (word: string): string =>
  `Paragraph ${word} keeps the harbour quiet while the gulls wheel over the bare mud.`

describe('paragraphsOf', () => {
  it('joins hard-wrapped lines and splits on blank lines, ones holding spaces included', () => {
    expect(
      paragraphsOf('The tide went out\n  and did not come back.\n   \n\nThe gulls stayed.\n'),
    ).toEqual(['The tide went out and did not come back.', 'The gulls stayed.'])
  })
})

describe('splitReplies', () => {
  it('closes a chunk when stopping lands nearer the target than taking the next paragraph', () => {
    const [one, two, three, four, five] = ['one', 'two', 'three', 'four', 'five'].map(harbour)
    const target = countTokens(one!) + countTokens(two!)
    const { opening, replies } = splitReplies([one, two, three, four, five].join('\n\n'), target)
    expect(opening).toBe(`${one}\n\n${two}`)
    expect(replies).toEqual([`${three}\n\n${four}`, five])
  })

  it('keeps a paragraph longer than the target whole, in a chunk of its own', () => {
    const short = harbour('short')
    const long = ['a', 'b', 'c', 'd', 'e', 'f'].map(harbour).join(' ')
    const after = harbour('after')
    const { opening, replies } = splitReplies([short, long, after].join('\n\n'), countTokens(short))
    expect(opening).toBe(short)
    expect(replies).toEqual([long, after])
  })

  it('refuses a text with nothing after the opening', () => {
    expect(() => splitReplies(harbour('alone'), 1_000)).toThrow(/no reply after the opening/)
  })
})

describe('actionProblem', () => {
  it('passes one first-person line within the cap', () => {
    expect(actionProblem('I bar the door and listen at the shutter.')).toBeNull()
    expect(actionProblem('“Who are you?” I ask.')).toBeNull()
  })

  it('names the broken rule', () => {
    expect(actionProblem('')).toMatch(/empty/)
    expect(actionProblem(' I wait.')).toMatch(/space around it/)
    expect(actionProblem('I wait.\nI listen.')).toMatch(/more than one line/)
    expect(actionProblem('The captain drinks his rum.')).toMatch(/first person/)
    const long = `I ${'walk down the long road to the cove and back again, '.repeat(6)}`.trim()
    expect(countTokens(long)).toBeGreaterThan(ACTION_MAX_TOKENS)
    expect(actionProblem(long)).toMatch(new RegExp(`over ${ACTION_MAX_TOKENS}$`))
  })
})

describe('the Treasure Island text', () => {
  it('starts at chapter I and holds no Gutenberg matter, part line or chapter heading', () => {
    expect(TEXT.startsWith('Squire Trelawney, Dr. Livesey')).toBe(true)
    expect(TEXT).not.toMatch(/Gutenberg|\*\*\*/i)
    expect(TEXT).not.toMatch(/^(?:PART |[IVX]+$)/m)
  })

  it('cuts into an opening and about 65 replies, every paragraph once and in order', () => {
    const { opening, replies } = splitReplies(TEXT, REPLY_TARGET_TOKENS)
    expect([opening, ...replies].flatMap((chunk) => chunk.split('\n\n'))).toEqual(
      paragraphsOf(TEXT),
    )
    expect(replies.length).toBeGreaterThanOrEqual(60)
    expect(replies.length).toBeLessThanOrEqual(70)
  })
})

describe('shapeDataset', () => {
  const { replies } = splitReplies(TEXT, REPLY_TARGET_TOKENS)
  const actions = replies.map((_, i) => `I take turn ${i + 1}.`)

  it('pairs each action with its reply, in order', () => {
    const dataset = shapeDataset(TEXT, actions)
    expect(dataset.turns.map((turn) => turn.action)).toEqual(actions)
    expect(dataset.turns.map((turn) => turn.reply)).toEqual(replies)
  })

  it('refuses an action count that differs from the replies', () => {
    expect(() => shapeDataset(TEXT, actions.slice(1))).toThrow(/actions for \d+ replies/)
  })
})

describe('the committed dataset', () => {
  const dataset = loadShapedDataset(fileURLToPath(new URL('.', import.meta.url).href))

  it('sums, opening and actions and replies, inside the band over about 130 entries', () => {
    const tokens = datasetTokens(dataset)
    expect(tokens).toBeGreaterThanOrEqual(DATASET_TOKEN_BAND.min)
    expect(tokens).toBeLessThanOrEqual(DATASET_TOKEN_BAND.max)
    expect(1 + 2 * dataset.turns.length).toBeGreaterThanOrEqual(120)
    expect(1 + 2 * dataset.turns.length).toBeLessThanOrEqual(140)
  })

  it('holds one action per reply, each keeping the form rule', () => {
    const problems = dataset.turns.flatMap((turn, i) => {
      const problem = actionProblem(turn.action)
      return problem === null ? [] : [`#${i + 1}: ${problem}`]
    })
    expect(problems).toEqual([])
  })
})
