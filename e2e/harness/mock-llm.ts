import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'

// A local OpenAI-compatible endpoint. The whole pipeline talks to one URL
// (POST …/chat/completions) but a turn fans out into several calls with
// different shapes — the streaming narrative, and later the non-streaming
// structured classifier. The mock routes on the request itself: `stream: true`
// → an SSE prose stream; otherwise → a JSON chat completion. Responses are
// canned and overridable per test so assertions stay deterministic. Exercises
// the real transport (lib/ai/transport), unlike the __DEV__-gated stub
// provider. See docs/testing.md → Mock LLM.

export type MockRequest = { body: Record<string, unknown>; streamed: boolean }

export type MockLlm = {
  /** baseURL to seed as the provider endpoint (already includes /v1). */
  url: string
  /** Set the prose the next streaming (narrative) call returns. */
  setNarrative: (content: string) => void
  /** Set the JSON object the next non-streaming (structured) call returns. */
  setStructured: (value: unknown) => void
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
  // A no-op classifier result (satisfies the fallback/periodic classifier
  // schemas: empty scene, no time change); overridable per test.
  let structured: unknown = { sceneEntities: [], worldTimeDelta: 0 }
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
      requests.push({ body, streamed })

      if (streamed) {
        res.writeHead(200, {
          ...cors,
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
        res.end(narrativeSse(narrative))
      } else {
        res.writeHead(200, { ...cors, 'content-type': 'application/json' })
        res.end(structuredCompletion(structured))
      }
    })()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}/v1`,
    setNarrative: (content) => {
      narrative = content
    },
    setStructured: (value) => {
      structured = value
    },
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
