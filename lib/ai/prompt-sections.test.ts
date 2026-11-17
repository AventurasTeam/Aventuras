import { simulateReadableStream, type LanguageModelUsage } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { logger } from '@/lib/diagnostics'
import type { HalfSections } from '@/lib/prompts'
import { countTokens } from '@/lib/retrieval'

import type { ProviderInstance } from '../db'
import { __clearPromptCountCache } from './context-window'
import { generateStructured, streamText } from './generate'
import { getModel } from './model'
import { promptContract, withClosing, type JsonSchema } from './prompt-schema'
import {
  countSections,
  promptSectionsOf,
  type CountedSections,
  type PromptSectionsInput,
} from './prompt-sections'

const { countTokensSpy } = vi.hoisted(() => ({
  countTokensSpy: vi.fn<(text: string) => number>(),
}))

// Counts as the real encoder does; the spy records which texts reached it.
vi.mock('@/lib/tokens', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  countTokensSpy.mockImplementation(actual.countTokens as (text: string) => number)
  return { ...actual, countTokens: countTokensSpy }
})
vi.mock('./model', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getModel: vi.fn(),
}))

const encoded = (text: string): boolean => countTokensSpy.mock.calls.some(([t]) => t === text)
const LOG = { providerId: 'prov-1', modelId: 'model-1' }

const half = (
  named: { id: HalfSections['named'][number]['id']; text: string }[],
  unnamed: string[] = [],
): HalfSections => ({ named, unnamed })

// Real prose, never a repeated character (lessons-learned: token fixtures need real prose).
const SETUP =
  '# Setting\nA drowned kingdom of marsh and ruin, where the old roads run under water.\n\n'
const SCENE = '# In scene\n## Kael\nA courier with a stolen sigil, soaked to the knee.\n\n'
const LORE = '# Relevant lore\nHouse Eldrin\nAn exiled line that still keeps its seal.\n\n'
const PROSE = [
  'The marsh road ended at a wall of black water.',
  'I test the stones with the butt of my spear',
  'The keep answered with a single lantern, swinging in the rain.',
]
const STORED = 42
const story = (contents: readonly string[]): string =>
  `# Story so far\n${contents.map((c) => `\n${c}\n`).join('')}`
const HISTORY = story(PROSE)
const BLANK_HISTORY = story(PROSE.map(() => ''))
const SEPARATOR = '\n'
const SYSTEM = SETUP
const USER = `${SCENE}${LORE}${SEPARATOR}${HISTORY}`

const input = (over: Partial<PromptSectionsInput> = {}): PromptSectionsInput => ({
  halves: {
    system: half([{ id: 'setup', text: SETUP }]),
    user: half(
      [
        { id: 'scene', text: SCENE },
        { id: 'lore', text: LORE },
        { id: 'history', text: HISTORY },
      ],
      [SEPARATOR],
    ),
  },
  history: {
    blank: {
      system: half([{ id: 'setup', text: SETUP }]),
      user: half([{ id: 'history', text: BLANK_HISTORY }]),
    },
    prose: { chars: PROSE.join('').length, tokens: STORED },
    renderMs: 3.4,
  },
  ...over,
})

beforeEach(() => {
  __clearPromptCountCache()
  countTokensSpy.mockClear()
  vi.restoreAllMocks()
})

describe('countSections', () => {
  it('counts each section, and the user half whole, untagged text included', () => {
    const counted = countSections(input(), LOG)
    const history = countTokens(BLANK_HISTORY) + STORED

    expect(counted.named).toEqual({
      setup: countTokens(SETUP),
      scene: countTokens(SCENE),
      lore: countTokens(LORE),
      history,
    })
    expect(counted.userTokens).toBe(
      countTokens(SCENE) + countTokens(LORE) + countTokens(SEPARATOR) + history,
    )
  })

  it('prices the history from stored counts, never encoding its prose', () => {
    countSections(input(), LOG)

    expect(encoded(HISTORY)).toBe(false)
  })

  it('encodes a history whose render does not hold the prose once and whole', () => {
    const doubled = story(PROSE.map((c) => `${c} ${c}`))
    const sections = input({
      halves: {
        system: half([]),
        user: half([{ id: 'history', text: doubled }]),
      },
    })

    expect(countSections(sections, LOG).named.history).toBe(countTokens(doubled))
    expect(encoded(doubled)).toBe(true)
  })

  it('counts every history piece directly without a price, and when it sits in the system half', () => {
    const plain = countSections(input({ history: undefined }), LOG)
    expect(plain.named.history).toBe(countTokens(HISTORY))

    const inSystem = input({
      halves: {
        system: half([{ id: 'history', text: HISTORY }]),
        user: half([{ id: 'scene', text: SCENE }]),
      },
    })
    expect(countSections(inSystem, LOG).named.history).toBe(countTokens(HISTORY))
  })

  it('adds a repeated id up', () => {
    const repeated = input({
      halves: {
        system: half([{ id: 'instructions', text: SETUP }]),
        user: half([{ id: 'instructions', text: SCENE }]),
      },
      history: undefined,
    })

    expect(countSections(repeated, LOG).named.instructions).toBe(
      countTokens(SETUP) + countTokens(SCENE),
    )
  })

  it("counts the call layer's contract under output, outside the user half", () => {
    const plain = countSections(input(), LOG)
    const contract = ['Respond strictly with JSON.', 'Output ONLY the JSON object.']
    const withContract = countSections(input(), { ...LOG, contract })

    expect(withContract.named.output).toBe(countTokens(contract[0]) + countTokens(contract[1]))
    expect(withContract.userTokens).toBe(plain.userTokens)
  })

  it('logs its cost and the blank render', () => {
    const debug = vi.spyOn(logger, 'debug')
    countSections(input(), { ...LOG, actionId: 'act_1' })

    expect(debug).toHaveBeenCalledWith(
      'provider.prompt_sections',
      { ...LOG, ms: expect.any(Number), renderMs: 3 },
      { actionId: 'act_1' },
    )
  })
})

describe('promptSectionsOf', () => {
  const counted = (named: CountedSections['named']): CountedSections => ({ named, userTokens: 0 })

  it('lists the named sections in vocabulary order, then Other as the rest of the estimate', () => {
    const sections = promptSectionsOf(counted({ history: 300, setup: 40, scene: 60 }), 450)

    expect(Object.entries(sections)).toEqual([
      ['setup', 40],
      ['scene', 60],
      ['history', 300],
      ['other', 50],
    ])
  })

  it('floors Other at zero and leaves out a zero section', () => {
    expect(promptSectionsOf(counted({ lore: 0, history: 300 }), 298)).toEqual({ history: 300 })
  })
})

// architecture.md → The pre-send check: the user half's count is recorded for the exact text sent,
// so the check doesn't encode it again.
describe('a call given its sections', () => {
  const provider = (type: 'openai-compatible' | 'anthropic'): ProviderInstance =>
    ({
      id: 'prov-1',
      type,
      displayName: 'P',
      apiKey: 'k',
      favoriteModelIds: [],
    }) as ProviderInstance
  const config = (
    type: 'openai-compatible' | 'anthropic' = 'openai-compatible',
    structuredOutput?: 'force-on',
  ) => ({
    providers: [provider(type)],
    profiles: [
      {
        id: 'prof-n',
        kind: 'narrative' as const,
        name: 'N',
        modelRef: { providerId: 'prov-1', modelId: 'model-1' },
      },
      {
        id: 'prof-c',
        kind: 'agent' as const,
        name: 'C',
        modelRef: { providerId: 'prov-1', modelId: 'model-1' },
        ...(structuredOutput !== undefined ? { structuredOutput } : {}),
      },
    ],
    assignments: { classifier: 'prof-c' },
  })
  const USAGE = {
    inputTokens: { total: 500, noCache: 100, cacheRead: 400, cacheWrite: undefined },
    outputTokens: { total: 9, text: 9, reasoning: undefined },
    raw: { prompt_tokens: 500, prompt_tokens_details: { cached_tokens: 400 } },
  }
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start' as const, warnings: [] },
          { type: 'text-start' as const, id: 't' },
          { type: 'text-delta' as const, id: 't', delta: 'The water held.' },
          { type: 'text-end' as const, id: 't' },
          {
            type: 'finish' as const,
            finishReason: { unified: 'stop' as const, raw: 'stop' },
            usage: USAGE,
          },
        ],
      }),
    }),
    doGenerate: async () => ({
      content: [{ type: 'text' as const, text: '{"summary":"The water held."}' }],
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage: USAGE,
      warnings: [],
    }),
  })
  const schema = z.object({ summary: z.string() })

  beforeEach(() => {
    vi.mocked(getModel).mockReturnValue(model as never)
  })

  it('streams the narrative call without encoding its user half, its sections summing to the estimate', async () => {
    const call = streamText('narrative', {
      prompt: { system: SYSTEM, user: USER },
      config: config(),
      sections: input(),
    })
    if (!call.ok) throw new Error('unresolved')
    await call.stream.consumeStream()

    expect(encoded(USER)).toBe(false)
    const estimate = call.promptEstimate()
    expect(estimate).toBe(countTokens(SYSTEM) + countSections(input(), LOG).userTokens)
    const sections = call.promptSections()
    expect(Object.values(sections ?? {}).reduce((n, t) => n + t, 0)).toBe(estimate)
    expect(call.tokensOf(await call.stream.usage)).toEqual({
      prompt: 500,
      completion: 9,
      cacheRead: 400,
    })
  })

  it("gives a refused call's sections against the estimate it refused", async () => {
    const tight = config()
    tight.providers = [
      { ...provider('openai-compatible'), contextWindowOverrides: { 'model-1': 10 } },
    ]
    let refusal: unknown
    const call = streamText('narrative', {
      prompt: { system: SYSTEM, user: USER },
      config: tight,
      sections: input(),
      onError: ({ error }) => {
        refusal = error
      },
    })
    if (!call.ok) throw new Error('unresolved')
    await call.stream.consumeStream()

    const failure = call.contextWindowFailureOf(refusal)
    expect(failure?.detectedBy).toBe('check')
    const sections = call.promptSections()
    expect(sections?.history).toBe(countTokens(BLANK_HISTORY) + STORED)
    expect(Object.values(sections ?? {}).reduce((n, t) => n + t, 0)).toBe(failure?.estimate)
  })

  it("primes a structured call's user text with its closing line, and counts the contract as output", async () => {
    const result = await generateStructured(
      'classifier',
      { system: SYSTEM, user: USER },
      schema,
      config(),
      new AbortController().signal,
      { actionId: null, sections: input() },
    )
    const { system: contract, closing } = promptContract(z.toJSONSchema(schema) as JsonSchema)

    expect(encoded(withClosing(USER, closing))).toBe(false)
    expect(model.doGenerateCalls.at(-1)?.prompt.at(-1)).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: withClosing(USER, closing) }],
    })
    if (result.status !== 'ok') throw new Error(result.status)
    expect(result.promptSections?.output).toBe(countTokens(contract) + countTokens(closing))
    expect(result.tokens).toEqual({ prompt: 500, completion: 9, cacheRead: 400 })
  })

  it('primes the user half as rendered when the schema goes natively', async () => {
    const result = await generateStructured(
      'classifier',
      { system: SYSTEM, user: USER },
      schema,
      config('openai-compatible', 'force-on'),
      new AbortController().signal,
      { actionId: null, sections: input() },
    )

    expect(encoded(USER)).toBe(false)
    if (result.status !== 'ok') throw new Error(result.status)
    expect(result.promptSections?.output).toBeUndefined()
  })

  it('reads the kept attempt only, after a reply that failed to parse', async () => {
    const replies = ['not json at all', '{"summary":"The water held."}']
    const retried = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: 'text' as const, text: replies.shift() ?? '' }],
        finishReason: { unified: 'stop' as const, raw: 'stop' },
        usage: {
          ...USAGE,
          raw: { prompt_tokens: 500, prompt_tokens_details: { cached_tokens: replies.length } },
        },
        warnings: [],
      }),
    })
    vi.mocked(getModel).mockReturnValue(retried as never)
    const result = await generateStructured(
      'classifier',
      { system: SYSTEM, user: USER },
      schema,
      config(),
      new AbortController().signal,
      { actionId: null },
    )

    if (result.status !== 'ok') throw new Error(result.status)
    expect(retried.doGenerateCalls).toHaveLength(2)
    expect(result.tokens?.cacheRead).toBe(0)
    expect(result.promptSections).toBeUndefined()
  })

  it.each<[string, LanguageModelUsage['raw']]>([['no details block', { prompt_tokens: 500 }]])(
    'reports no cache figure for %s',
    async (_label, raw) => {
      const bare = new MockLanguageModelV3({
        doGenerate: async () => ({
          content: [{ type: 'text' as const, text: '{"summary":"x"}' }],
          finishReason: { unified: 'stop' as const, raw: 'stop' },
          usage: { ...USAGE, raw },
          warnings: [],
        }),
      })
      vi.mocked(getModel).mockReturnValue(bare as never)
      const result = await generateStructured(
        'classifier',
        { system: SYSTEM, user: USER },
        schema,
        config(),
        new AbortController().signal,
        { actionId: null },
      )

      if (result.status !== 'ok') throw new Error(result.status)
      expect(result.tokens).toEqual({ prompt: 500, completion: 9 })
    },
  )
})
