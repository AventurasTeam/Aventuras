import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { z } from 'zod'

import {
  actionProblem,
  cleanedAction,
  DATASET_ACTIONS_FILE,
  DATASET_TEXT_FILE,
  parseActions,
  REPLY_TARGET_TOKENS,
  saveActions,
  splitReplies,
} from './shape'

// Opt-in, run once: one first-person action per reply of the dataset text, written by a real model
// and committed as actions.json. Resumes a shorter actions.json; --fresh starts over.
//   SMOKE_LLM_URL=http://host:port/v1 SMOKE_LLM_MODEL=<id> pnpm dataset:actions [--fresh]
// SMOKE_LLM_KEY (none).
const LLM_URL = process.env.SMOKE_LLM_URL
const LLM_MODEL = process.env.SMOKE_LLM_MODEL
const LLM_KEY = process.env.SMOKE_LLM_KEY ?? ''
const HERE = dirname(fileURLToPath(import.meta.url))
const ACTIONS_PATH = join(HERE, DATASET_ACTIONS_FILE)
const ATTEMPTS = 4
const CALL_TIMEOUT_MS = 300_000

const SYSTEM = [
  'You write the player’s turns for an interactive story made from a novel. The novel is told in the first person by Jim Hawkins, and the player plays Jim.',
  '',
  'You get two passages. BEFORE is what the player has just read. AFTER is what the story tells next. Write the one turn the player types between them: what Jim does or says next, as AFTER shows it.',
  '',
  'Rules:',
  '- First person, present tense, the way a player types a turn: "I ...". Speech goes in quotes, followed by "I say" or "I ask".',
  '- State only what AFTER shows Jim doing or saying. Add no fact, name, object or event that AFTER does not show.',
  '- If Jim neither acts nor speaks in AFTER, write that he watches, listens or waits, and nothing more.',
  '- Never say what anyone but Jim does or says.',
  '- One or two short sentences.',
  '- Reply with the turn alone: no label, no quotes around it, no explanation.',
].join('\n')

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullish() }),
        finish_reason: z.string().nullish(),
      }),
    )
    .min(1),
})

async function complete(
  url: string,
  model: string,
  before: string,
  after: string,
): Promise<{ text: string; finish: string | null }> {
  const response = await fetch(`${url.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(LLM_KEY ? { authorization: `Bearer ${LLM_KEY}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `BEFORE:\n${before}\n\nAFTER:\n${after}` },
      ],
      temperature: 0.4,
      max_tokens: 2048,
      // llama.cpp/vLLM only: stops a thinking model spending the budget on reasoning.
      ...(LLM_KEY ? {} : { chat_template_kwargs: { enable_thinking: false } }),
      stream: false,
    }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`)
  }
  const choice = completionSchema.parse(await response.json()).choices[0]!
  return { text: choice.message.content ?? '', finish: choice.finish_reason ?? null }
}

async function writeAction(
  url: string,
  model: string,
  before: string,
  after: string,
  index: number,
): Promise<string> {
  let last = ''
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const { text, finish } = await complete(url, model, before, after)
    const action = cleanedAction(text)
    const problem = finish === 'length' ? 'cut off at the length limit' : actionProblem(action)
    if (problem === null) return action
    last = `${problem}: ${JSON.stringify(text.slice(0, 300))}`
    console.warn(`#${index + 1} attempt ${attempt}: ${last}`)
  }
  throw new Error(`#${index + 1}: no usable action in ${ATTEMPTS} attempts (${last})`)
}

function existingActions(fresh: boolean): string[] {
  if (fresh || !existsSync(ACTIONS_PATH)) return []
  return parseActions(readFileSync(ACTIONS_PATH, 'utf8'))
}

async function main(): Promise<void> {
  if (!LLM_URL || !LLM_MODEL) throw new Error('set SMOKE_LLM_URL and SMOKE_LLM_MODEL')
  const text = readFileSync(join(HERE, DATASET_TEXT_FILE), 'utf8')
  const { opening, replies } = splitReplies(text, REPLY_TARGET_TOKENS)
  const actions = existingActions(process.argv.includes('--fresh'))
  if (actions.length > replies.length) {
    throw new Error(
      `${ACTIONS_PATH} holds ${actions.length} actions for ${replies.length} replies: rerun with --fresh`,
    )
  }
  if (actions.length > 0) console.log(`resuming after ${actions.length} of ${replies.length}`)
  for (let i = actions.length; i < replies.length; i++) {
    const before = i === 0 ? opening : replies[i - 1]!
    const action = await writeAction(LLM_URL, LLM_MODEL, before, replies[i]!, i)
    actions.push(action)
    saveActions(ACTIONS_PATH, actions)
    console.log(`#${i + 1}/${replies.length} ${action}\n    ${replies[i]!.slice(0, 160)}`)
  }
  console.log(`${actions.length} actions in ${ACTIONS_PATH}`)
}

main().catch((err: unknown) => {
  console.error('[dataset:actions]', err instanceof Error ? err.message : err)
  process.exit(1)
})
