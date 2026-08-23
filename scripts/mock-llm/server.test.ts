import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { schemaToTypeScriptBlock, type JsonSchema } from '@/lib/ai'
import { parseStateBlock, parseSuggestionsBlock, stripTrailingBlocks } from '@/lib/piggyback'
import { fallbackClassifierSchema } from '@/lib/pipeline'
import { renderTemplate, TEMPLATE_IDS } from '@/lib/prompts'
import { labeledPromptOutputSchema } from '@/lib/wizard'

import { collectSseContent } from './passthrough'
import { startMockServer, type MockServer } from './server'

let mock: MockServer

beforeAll(async () => {
  mock = await startMockServer(0, { persist: false })
})

afterAll(async () => {
  await mock.close()
})

const base = (): string => mock.url.replace(/\/v1$/, '')

async function post(body: unknown, signal?: AbortSignal): Promise<Response> {
  return fetch(`${mock.url}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  })
}

/** The first log entry to land, however long the handler's own delay runs. */
async function waitForEntry(): Promise<{ outcome: string }> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const [entry] = mock.ctx.log.list()
    if (entry) return entry
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('no log entry arrived')
}

/** The prompt the app would send for `schema` on the default (auto) path. */
function structuredPrompt(schema: z.ZodType, text = 'Classify the turn.'): string {
  const block = schemaToTypeScriptBlock(z.toJSONSchema(schema) as JsonSchema)
  return `${text}\n\nRespond strictly with JSON. The JSON should be compatible with the TypeScript type Response from the following:\n\n${block}\n\nOutput ONLY the JSON object, no other text or markdown.`
}

function structuredRequest(schema: z.ZodType): Record<string, unknown> {
  return {
    model: 'seed/narrative',
    messages: [{ role: 'user', content: structuredPrompt(schema) }],
  }
}

async function narrativeText(response: Response): Promise<string> {
  return collectSseContent(await response.text())
}

describe('structured calls', () => {
  it("answers with the lane's active response, parseable by the app's schema", async () => {
    const response = await post(structuredRequest(fallbackClassifierSchema))
    expect(response.status).toBe(200)

    const body = (await response.json()) as { choices: { message: { content: string } }[] }
    const value = fallbackClassifierSchema.parse(JSON.parse(body.choices[0]?.message.content ?? ''))

    expect(value.worldTimeDelta).toBe(0)
    expect(value.sceneEntities).toEqual([])
  })

  it('answers a wizard call on the lane its own template names, with a reply that shape accepts', async () => {
    const prompt = renderTemplate(TEMPLATE_IDS.wizardTone, {
      definition: { setting: 'A city that flooded and stayed.', genre: {}, tone: {} },
      guidance: '',
    })
    const response = await post({
      model: 'seed/narrative',
      messages: [{ role: 'user', content: structuredPrompt(labeledPromptOutputSchema, prompt) }],
    })

    const body = (await response.json()) as { choices: { message: { content: string } }[] }
    const value = labeledPromptOutputSchema.parse(
      JSON.parse(body.choices[0]?.message.content ?? ''),
    )
    expect(value.promptBody).not.toBe('')

    // Genre answers the same schema, so only the marker keeps the two apart.
    const [entry] = mock.ctx.log.list()
    expect(entry?.lane).toBe('wizard-tone')
  })

  it('answers {} for a shape nobody has configured, and opens a lane for it', async () => {
    const novel = z.object({ mood: z.string() })
    const response = await post(structuredRequest(novel))

    const body = (await response.json()) as { choices: { message: { content: string } }[] }
    expect(body.choices[0]?.message.content).toBe('{}')

    const discovered = [...mock.ctx.discovered.values()]
    const entry = discovered.find((d) => d.block?.includes('mood: string;'))
    expect(entry).toBeDefined()
    expect(mock.ctx.state.lanes[entry?.key ?? '']).toBeDefined()
    // A registered shape routes to its own lane and must never be discovered.
    expect(discovered.some((d) => d.key === 'per-turn-classifier')).toBe(false)
  })
})

describe('narrative streaming', () => {
  it('streams prose the reader can split from the trailing state block', async () => {
    mock.ctx.lane('narrative').stream = { charsPerSecond: 0, chunkSize: 6 }
    const response = await post({ model: 'seed/narrative', stream: true, messages: [] })

    expect(response.headers.get('content-type')).toContain('text/event-stream')

    const content = await narrativeText(response)
    expect(stripTrailingBlocks(content).prose).toBe(
      'The blade rasps free of its sheath. Somewhere in the drowned city, a bell answers, and the rain leans closer to listen.',
    )

    const state = parseStateBlock(content)
    expect(state.failures).toEqual([])
    expect(state.block.worldTimeDelta).toBe(60)
  })

  it('delivers the same content in many frames when paced', async () => {
    mock.ctx.lane('narrative').stream = { charsPerSecond: 100_000, chunkSize: 6 }
    const raw = await (await post({ model: 'seed/narrative', stream: true, messages: [] })).text()

    const frames = raw.split('\n\n').filter((f) => f.startsWith('data:') && !f.includes('[DONE]'))
    expect(frames.length).toBeGreaterThan(5)
    expect(collectSseContent(raw)).toContain('The blade rasps free of its sheath.')
  })

  it('serves the suggestions block when the chosen response carries one', async () => {
    const lane = mock.ctx.lane('narrative')
    lane.stream = { charsPerSecond: 0, chunkSize: 6 }
    lane.activeId = lane.responses.find((r) => r.name === 'With suggestions')?.id ?? lane.activeId

    const content = await narrativeText(
      await post({ model: 'seed/narrative', stream: true, messages: [] }),
    )
    const suggestions = parseSuggestionsBlock(content)

    expect(suggestions.failed).toBe(false)
    expect(suggestions.items.map((i) => i.categoryRef)).toEqual(['cat1', 'cat2', 'cat3'])

    lane.activeId = lane.responses[0]?.id ?? null
  })
})

describe('failure injection', () => {
  it('returns the configured status and stops after the countdown', async () => {
    const lane = mock.ctx.lane('per-turn-classifier')
    lane.failure = { kind: 'http', status: 429, remaining: 1 }

    expect((await post(structuredRequest(fallbackClassifierSchema))).status).toBe(429)
    expect((await post(structuredRequest(fallbackClassifierSchema))).status).toBe(200)
  })

  it('serves a reply the app cannot repair into a valid object', async () => {
    const lane = mock.ctx.lane('per-turn-classifier')
    lane.failure = { kind: 'malformed', status: 500, remaining: 1 }

    const body = (await (await post(structuredRequest(fallbackClassifierSchema))).json()) as {
      choices: { message: { content: string } }[]
    }
    const raw = body.choices[0]?.message.content ?? ''

    expect(() => fallbackClassifierSchema.parse(JSON.parse(raw))).toThrow()
  })

  it('cuts a narrative stream short with no stop frame', async () => {
    const lane = mock.ctx.lane('narrative')
    lane.stream = { charsPerSecond: 100_000, chunkSize: 6 }
    lane.failure = { kind: 'stream-cut', status: 500, remaining: 1 }

    const raw = await (await post({ model: 'seed/narrative', stream: true, messages: [] })).text()

    expect(raw).not.toContain('[DONE]')
    expect(raw).not.toContain('"finish_reason":"stop"')
    expect(collectSseContent(raw).length).toBeGreaterThan(0)

    lane.failure = { kind: 'none', status: 500, remaining: 0 }
  })

  it('does not spend a sequence entry on a call it failed', async () => {
    const lane = mock.ctx.lane('narrative')
    lane.stream = { charsPerSecond: 0, chunkSize: 6 }
    lane.sequence = { enabled: true, ids: lane.responses.map((r) => r.id), cursor: 0, loop: true }
    lane.failure = { kind: 'http', status: 500, remaining: 1 }

    await post({ model: 'seed/narrative', stream: true, messages: [] })
    expect(lane.sequence.cursor).toBe(0)

    const content = await narrativeText(
      await post({ model: 'seed/narrative', stream: true, messages: [] }),
    )
    expect(content).toContain('The blade rasps free of its sheath.')
    expect(lane.sequence.cursor).toBe(1)

    lane.sequence.enabled = false
  })
})

describe('client abort', () => {
  it('leaves the failure budget intact for a call nobody waited for', async () => {
    mock.ctx.log.clear()
    const lane = mock.ctx.lane('narrative')
    lane.delay = { ttfbMs: 300, jitterMs: 0 }
    lane.failure = { kind: 'http', status: 503, remaining: 1 }

    const abort = new AbortController()
    const inflight = post({ model: 'seed/narrative', stream: true, messages: [] }, abort.signal)
    await new Promise((resolve) => setTimeout(resolve, 50))
    abort.abort()
    await inflight.catch(() => null)

    // The handler is still sleeping out its TTFB; it logs when that finishes.
    const entry = await waitForEntry()
    expect(entry.outcome).toBe('aborted')
    // The whole point of the one-shot budget: it belongs to the next call that
    // is actually served, not to one that was abandoned before it was answered.
    expect(lane.failure.remaining).toBe(1)

    lane.delay = { ttfbMs: 0, jitterMs: 0 }
    expect((await post({ model: 'seed/narrative', stream: true, messages: [] })).status).toBe(503)
    lane.failure = { kind: 'none', status: 500, remaining: 0 }
  })
})

describe('catalog and control surface', () => {
  it('advertises the model id the seed pins taggedBlockReliable to', async () => {
    const body = (await (await fetch(`${mock.url}/models`)).json()) as { data: { id: string }[] }
    expect(body.data.map((m) => m.id)).toContain('seed/narrative')
  })

  it('logs each call with its lane and the placeholders its prompt offered', async () => {
    mock.ctx.log.clear()
    await post({
      model: 'seed/narrative',
      messages: [
        {
          role: 'user',
          content:
            'Cast:\n[c1] Kael, sellsword\n[c2] Mira\n[lo1] The Drowning\nLocation: [l1] The Harbour',
        },
      ],
    })

    const entries = (await (await fetch(`${base()}/api/log`)).json()) as {
      lane: string
      placeholders: { ref: string; label: string }[]
    }[]

    expect(entries).toHaveLength(1)
    expect(entries[0]?.lane).toBe('unknown:no-schema')
    expect(entries[0]?.placeholders).toEqual([
      { ref: 'c1', label: 'Kael, sellsword' },
      { ref: 'c2', label: 'Mira' },
      { ref: 'lo1', label: 'The Drowning' },
      { ref: 'l1', label: 'The Harbour' },
    ])
  })

  it('reads the roster out of a real wizard prompt, whose cast rows are not bracketed', async () => {
    mock.ctx.log.clear()
    // The macro itself, not a transcription of it: the extractor has to track
    // whatever macro_wizard_opening_context actually renders.
    const prompt = renderTemplate(TEMPLATE_IDS.wizardOpening, {
      definition: { mode: 'adventure', genre: {}, tone: {} },
      leadEntityId: 'c1',
      lore: [],
      cast: [
        {
          id: 'c1',
          name: 'Kael Ashwater',
          kind: 'character',
          status: 'active',
          description: 'A diver.',
        },
        {
          id: 'l1',
          name: 'The Drowned Exchange',
          kind: 'location',
          status: 'active',
          description: '',
        },
        { id: 'c2', name: 'Verity Sould', kind: 'character', status: 'staged', description: '' },
      ],
      guidance: '',
    })
    await post({ model: 'seed/narrative', messages: [{ role: 'user', content: prompt }] })

    const entries = (await (await fetch(`${base()}/api/log`)).json()) as {
      placeholders: { ref: string; label: string }[]
    }[]

    // Staged rows are filtered out of the prompt by the macro, so the roster
    // the panel pins is exactly the one the reply may legally reference.
    expect(entries[0]?.placeholders).toEqual([
      { ref: 'c1', label: 'Kael Ashwater' },
      { ref: 'l1', label: 'The Drowned Exchange' },
    ])
  })

  it('keeps inline placeholders separate instead of folding them into one label', async () => {
    mock.ctx.log.clear()
    await post({
      model: 'seed/narrative',
      messages: [{ role: 'user', content: 'Present: [c1] Kael and [c2] Mira.' }],
    })

    const entries = (await (await fetch(`${base()}/api/log`)).json()) as {
      placeholders: { ref: string; label: string }[]
    }[]

    expect(entries[0]?.placeholders).toEqual([
      { ref: 'c1', label: 'Kael and' },
      { ref: 'c2', label: 'Mira.' },
    ])
  })
})
