import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'

import { z } from 'zod'

import { schemaToTypeScriptBlock, type JsonSchema } from '@/lib/ai'
import { fallbackClassifierSchema } from '@/lib/pipeline'

// A local OpenAI-compatible endpoint. The whole pipeline talks to one URL
// (POST …/chat/completions) but a turn fans out into calls with different
// shapes. The mock routes on the request:
//   - stream: true          → an SSE prose stream (the narrative call).
//   - otherwise (structured) → a JSON chat completion, whose body is chosen by
//     matching the exact TypeScript block the app injects into the prompt
//     (schemaToTypeScriptBlock over the agent's zod schema). Each structured
//     agent is one STRUCTURED_AGENTS entry; adding one is mechanical and the
//     match can't drift because it reuses the app's own renderer.
// Exercises the real transport (lib/ai/transport), unlike the __DEV__-gated
// stub provider. See docs/testing.md → Mock LLM.

export type MockRequest = {
  body: Record<string, unknown>
  streamed: boolean
  /** For structured calls, which agent's schema the prompt matched (or null). */
  agent: string | null
}

// One entry per structured agent. `block` is the exact string the app renders
// into the prompt for this schema; `example` is a schema-valid default reply.
type StructuredAgent = { name: string; block: string; example: unknown }

const STRUCTURED_AGENTS: StructuredAgent[] = [
  {
    name: 'per-turn-classifier',
    block: schemaToTypeScriptBlock(z.toJSONSchema(fallbackClassifierSchema) as JsonSchema),
    // No-op: empty scene, no time change — parses and applies cleanly.
    example: { sceneEntities: [], worldTimeDelta: 0 },
  },
]

export type MockLlm = {
  /** baseURL to seed as the provider endpoint (already includes /v1). */
  url: string
  /** Set the prose the next streaming (narrative) call returns. */
  setNarrative: (content: string) => void
  /** Override a structured agent's reply (defaults to its schema-valid example). */
  setStructured: (agentName: string, value: unknown) => void
  /** Every completion request received, in order. */
  requests: MockRequest[]
  close: () => Promise<void>
}

const DEFAULT_NARRATIVE =
  'The blade rasps free of its sheath. Somewhere in the drowned city, a bell answers, and the rain leans closer to listen.'

function sse(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

function narrativeSse(content: string): string {
  const base = { id: 'chatcmpl-mock', object: 'chat.completion.chunk', created: 0, model: 'mock' }
  const frames = [
    {
      ...base,
      choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
    },
    { ...base, choices: [{ index: 0, delta: { content }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ]
  return frames.map(sse).join('') + 'data: [DONE]\n\n'
}

function structuredCompletion(value: unknown): string {
  return JSON.stringify({
    id: 'chatcmpl-mock',
    object: 'chat.completion',
    created: 0,
    model: 'mock',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: JSON.stringify(value) },
        finish_reason: 'stop',
      },
    ],
  })
}

// The injected schema block lives in the message content (the app's auto path
// renders it into the prompt); flatten every message to one searchable string.
function promptText(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? body.messages : []
  return messages
    .map((m) => {
      const content = (m as { content?: unknown }).content
      if (typeof content === 'string') return content
      if (Array.isArray(content))
        return content.map((p) => (p as { text?: string }).text ?? '').join('\n')
      return ''
    })
    .join('\n')
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

export async function startMockLlm(): Promise<MockLlm> {
  let narrative = DEFAULT_NARRATIVE
  const overrides = new Map<string, unknown>()
  const requests: MockRequest[] = []

  // The renderer fetches cross-origin (its own origin → this server), which
  // triggers a CORS preflight; answer it and tag every response, so the call
  // isn't blocked in dev (http origin) the way it would be without headers.
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': '*',
  }

  const server = createServer((req, res) => {
    void (async () => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors).end()
        return
      }
      if (!req.url?.endsWith('/chat/completions') || req.method !== 'POST') {
        res.writeHead(404, cors).end()
        return
      }
      const raw = await readBody(req)
      const body = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>
      const streamed = body.stream === true

      if (streamed) {
        requests.push({ body, streamed, agent: null })
        res.writeHead(200, {
          ...cors,
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
        res.end(narrativeSse(narrative))
        return
      }

      const text = promptText(body)
      const agent = STRUCTURED_AGENTS.find((a) => text.includes(a.block)) ?? null
      requests.push({ body, streamed, agent: agent?.name ?? null })
      const value = agent ? (overrides.get(agent.name) ?? agent.example) : {}
      res.writeHead(200, { ...cors, 'content-type': 'application/json' })
      res.end(structuredCompletion(value))
    })()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}/v1`,
    setNarrative: (content) => {
      narrative = content
    },
    setStructured: (agentName, value) => {
      overrides.set(agentName, value)
    },
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
