import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import { matchShape } from '../../scripts/mock-llm/routing'

// A local OpenAI-compatible endpoint. The whole pipeline talks to one URL
// (POST …/chat/completions) but a turn fans out into calls with different
// shapes. The mock routes on the request:
//   - stream: true          → an SSE prose stream (the narrative call).
//   - otherwise (structured) → a JSON chat completion, whose body is chosen by
//     matching the exact TypeScript block the app injects into the prompt
//     (schemaToTypeScriptBlock over the agent's zod schema). Each reply shape
//     is one STRUCTURED_SHAPES entry — an agent with more than one possible
//     schema (e.g. the classifier with/without suggestions) gets one entry per
//     shape; adding one is mechanical and the match can't drift because it
//     reuses the app's own renderer.
// Exercises the real transport (lib/ai/transport), unlike the __DEV__-gated
// stub provider. See docs/testing.md → Mock LLM.
//
// The shape registry is shared with the dev mock server (scripts/mock-llm).
// The default replies below are NOT: these are deliberately inert so a spec
// that never calls setStructured writes nothing, whereas the dev tool's
// defaults are chosen to make a hand-driven turn visibly do something.

export type MockRequest = {
  body: Record<string, unknown>
  streamed: boolean
  /** For structured calls, which agent's schema the prompt matched (or null). */
  agent: string | null
}

// Exported so scripts/mock-llm/shapes.test.ts can assert every registered shape
// still has one and that each is schema-valid — a shape added to the shared
// registry without an entry here would otherwise serve `undefined` mid-suite.
export const EXAMPLES: Record<string, unknown> = {
  // No-op: empty scene, no time change — parses and applies cleanly.
  'per-turn-classifier': { sceneEntities: [], worldTimeDelta: 0 },
  // Silence is valid: the default reply must not write anything, so specs opt
  // in to graph writes via setStructured.
  'periodic-classifier': {
    happenings: [],
    relationships: [],
    statusFlips: [],
    newCharacters: [],
  },
  // Same logical agent as per-turn-classifier, second reply shape: the
  // classifier's schema grows a `suggestions` field whenever the run asks for
  // chips (suggestionsEnabled AND at least one enabled category, and no chips
  // already in hand), which changes the injected TS block enough that it no
  // longer matches the base entry (see per-turn-piggyback.ts). Distinct name so
  // setStructured can target this shape without also overriding the base one.
  'per-turn-classifier-suggestions': { sceneEntities: [], worldTimeDelta: 0, suggestions: [] },
  // One resolvable chip, NOT zero: a refresh that resolves nothing is now a
  // run failure, so an empty default would fail any spec that reaches ⟳
  // without calling setStructured. cat1 is the first enabled category.
  'suggestion-refresh': { suggestions: [{ categoryRef: 'cat1', text: 'You press on.' }] },
}

export type MockLlm = {
  /** baseURL to seed as the provider endpoint (already includes /v1). */
  url: string
  /** Set the prose the next streaming (narrative) call returns. */
  setNarrative: (content: string) => void
  /** Override a structured agent's reply (defaults to its schema-valid example). */
  setStructured: (agentName: string, value: unknown) => void
  /** One-shot: the next narrative (streaming) call fails with HTTP 500. */
  failNextNarrative: () => void
  /**
   * One-shot: the next narrative call opens its SSE stream but holds it open (no
   * finish) until releaseNarrative() or a client abort — the deterministic
   * in-flight window the cancel test needs.
   */
  holdNextNarrative: () => void
  /** Finish any held narrative streams with the current narrative content. */
  releaseNarrative: () => void
  /** Every completion request received, in order. */
  requests: MockRequest[]
  close: () => Promise<void>
}

const DEFAULT_NARRATIVE =
  'The blade rasps free of its sheath. Somewhere in the drowned city, a bell answers, and the rain leans closer to listen.'

function sse(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

const CHUNK_BASE = {
  id: 'chatcmpl-mock',
  object: 'chat.completion.chunk',
  created: 0,
  model: 'mock',
}

// The opening role frame, emitted on its own to hold a stream open — a
// started-but-unfinished narrative call, so the cancel test has an in-flight
// window. The tail (content + stop + [DONE]) completes it.
function narrativeRoleFrame(): string {
  return sse({
    ...CHUNK_BASE,
    choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
  })
}

function narrativeTail(content: string): string {
  const frames = [
    { ...CHUNK_BASE, choices: [{ index: 0, delta: { content }, finish_reason: null }] },
    { ...CHUNK_BASE, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ]
  return frames.map(sse).join('') + 'data: [DONE]\n\n'
}

function narrativeSse(content: string): string {
  return narrativeRoleFrame() + narrativeTail(content)
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
  let failNarrativeNext = false
  let holdNarrativeNext = false
  // Streams held open (hold mode): tracked so release/close can finish them and
  // a client abort can drop them — an unfinished socket would hang server.close().
  const heldResponses = new Set<ServerResponse>()

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
        if (failNarrativeNext) {
          failNarrativeNext = false
          res.writeHead(500, { ...cors, 'content-type': 'application/json' })
          res.end(
            JSON.stringify({ error: { message: 'mock injected failure', type: 'server_error' } }),
          )
          return
        }
        res.writeHead(200, {
          ...cors,
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
        if (holdNarrativeNext) {
          holdNarrativeNext = false
          // Open the stream but don't finish it: the run stays in-flight
          // (isGenerating) until release or the client aborts on cancel.
          res.write(narrativeRoleFrame())
          heldResponses.add(res)
          res.on('close', () => heldResponses.delete(res))
          return
        }
        res.end(narrativeSse(narrative))
        return
      }

      const text = promptText(body)
      const agent = matchShape(null, text)
      requests.push({ body, streamed, agent: agent?.name ?? null })
      const value = agent ? (overrides.get(agent.name) ?? EXAMPLES[agent.name]) : {}
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
    failNextNarrative: () => {
      failNarrativeNext = true
    },
    holdNextNarrative: () => {
      holdNarrativeNext = true
    },
    releaseNarrative: () => {
      for (const res of heldResponses) res.end(narrativeTail(narrative))
      heldResponses.clear()
    },
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        // Finish held streams first, else an open socket hangs server.close().
        for (const res of heldResponses) res.end(narrativeTail(narrative))
        heldResponses.clear()
        server.close(() => resolve())
      }),
  }
}
