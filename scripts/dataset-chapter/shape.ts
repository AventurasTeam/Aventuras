import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'

import { countTokens } from '@/lib/tokens'

export const DATASET_TEXT_FILE = 'treasure-island.txt'
export const DATASET_ACTIONS_FILE = 'actions.json'

/** About a played reply's length: chapters I–IX cut into an opening and 66 replies. */
export const REPLY_TARGET_TOKENS = 350

/** Criterion 26's band over the whole open region, opening included. */
export const DATASET_TOKEN_BAND = { min: 22_000, max: 26_000 } as const

/** 66 actions at this cap keep the text's 22.9k tokens under the band's top. */
export const ACTION_MAX_TOKENS = 45

export type ShapedDataset = { opening: string; turns: { action: string; reply: string }[] }

const actionsSchema = z.array(z.string())

/** Blank-line separated paragraphs, each hard-wrapped line trimmed and joined with a space. */
export function paragraphsOf(text: string): string[] {
  return text
    .split(/\n[ \t]*\n/)
    .map((block) =>
      block
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .join(' '),
    )
    .filter((paragraph) => paragraph !== '')
}

/**
 * Whole paragraphs packed in order: a chunk closes before a paragraph when stopping lands nearer
 * `targetTokens` than taking it, so no paragraph is ever cut. The first chunk is the opening.
 */
export function splitReplies(
  text: string,
  targetTokens: number,
): { opening: string; replies: string[] } {
  const chunks: string[][] = []
  let current: string[] = []
  let size = 0
  for (const paragraph of paragraphsOf(text)) {
    const cost = countTokens(paragraph)
    const nearerWithout = Math.abs(size + cost - targetTokens) > Math.abs(size - targetTokens)
    if (current.length > 0 && nearerWithout) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(paragraph)
    size += cost
  }
  if (current.length > 0) chunks.push(current)
  const [opening, ...replies] = chunks.map((chunk) => chunk.join('\n\n'))
  if (opening === undefined || replies.length === 0)
    throw new Error('splitReplies: the text holds no reply after the opening')
  return { opening, replies }
}

export function shapeDataset(text: string, actions: readonly string[]): ShapedDataset {
  const { opening, replies } = splitReplies(text, REPLY_TARGET_TOKENS)
  if (actions.length !== replies.length)
    throw new Error(`shapeDataset: ${actions.length} actions for ${replies.length} replies`)
  return { opening, turns: replies.map((reply, i) => ({ action: actions[i]!, reply })) }
}

/** The open region's `content_tokens` sum once every turn has landed. */
export function datasetTokens(dataset: ShapedDataset): number {
  return dataset.turns.reduce(
    (sum, turn) => sum + countTokens(turn.action) + countTokens(turn.reply),
    countTokens(dataset.opening),
  )
}

// Whether an action adds a fact its reply doesn't show is read by eye, not here.
/** Why an action breaks the form rule (one line, first person, within the cap), or null. */
export function actionProblem(action: string): string | null {
  if (action === '' || action !== action.trim()) return 'empty, or space around it'
  if (action.includes('\n')) return 'more than one line'
  if (!/\bI\b/.test(action)) return 'not in the first person'
  const tokens = countTokens(action)
  if (tokens > ACTION_MAX_TOKENS) return `${tokens} tokens, over ${ACTION_MAX_TOKENS}`
  return null
}

export function parseActions(json: string): string[] {
  return actionsSchema.parse(JSON.parse(json))
}

export function loadShapedDataset(dir: string): ShapedDataset {
  const text = readFileSync(join(dir, DATASET_TEXT_FILE), 'utf8')
  const actions = parseActions(readFileSync(join(dir, DATASET_ACTIONS_FILE), 'utf8'))
  return shapeDataset(text, actions)
}
