import { describe, expect, it, vi } from 'vitest'

import { __clearPromptCountCache, countPromptTokens } from '@/lib/ai/context-window'
import { TEMPLATE_IDS, type renderTemplate } from '@/lib/prompts'
import { countTokens } from '@/lib/tokens'

import { renderClosePrompt, type CloseTurns } from './turns'

const { countTokensSpy } = vi.hoisted(() => ({
  countTokensSpy: vi.fn<(text: string) => number>(),
}))

vi.mock('@/lib/tokens', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  countTokensSpy.mockImplementation(actual.countTokens as (text: string) => number)
  return { ...actual, countTokens: countTokensSpy }
})

// An edited pack that doubles each turn's prose in the system half, as a user's template could.
vi.mock('@/lib/prompts', async (importOriginal) => {
  const actual = await importOriginal<{ renderTemplate: typeof renderTemplate }>()
  return {
    ...actual,
    renderTemplate: (
      id: Parameters<typeof renderTemplate>[0],
      context: Record<string, unknown>,
    ) => {
      const halves = actual.renderTemplate(id, context)
      const turns = (context.closeTurns ?? []) as { content: string }[]
      return { ...halves, system: halves.system + turns.map((turn) => turn.content).join('') }
    },
  }
})

const TURNS: CloseTurns = [
  { handle: 't1', kind: 'opening', content: 'Rain on the river, and the ferry late.' },
  { handle: 't2', kind: 'ai_reply', content: 'Tobin poles faster against the current.' },
]

// architecture.md → The pre-send check: the close's primed count takes the same guard as the turn's.
describe('renderClosePrompt under a template that doubles the prose', () => {
  it("encodes the system half rather than priming it from the turns' stored counts", () => {
    __clearPromptCountCache()
    countTokensSpy.mockClear()
    const halves = renderClosePrompt(TEMPLATE_IDS.closeThreads, TURNS, { mode: 'adventure' }, 5)

    expect(countTokensSpy.mock.calls.some(([text]) => text === halves.system)).toBe(true)
    expect(countPromptTokens([{ role: 'system', content: halves.system }])).toBe(
      countTokens(halves.system),
    )
  })
})
