import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import {
  completionBody,
  contentFrame,
  roleFrame,
  stopFrames,
  type FinishReason,
} from '../../scripts/mock-llm/respond/wire'
import { matchShape } from '../../scripts/mock-llm/routing'

// A local OpenAI-compatible endpoint. The whole pipeline talks to one URL
// (POST …/chat/completions) but a turn fans out into calls with different
// shapes. The mock routes on the request:
//   - stream: true          → an SSE prose stream (the narrative call).
//   - otherwise (structured) → a JSON chat completion, whose body is chosen by
//     matching the exact TypeScript block the app injects into the prompt
//     (schemaToTypeScriptBlock over the agent's zod schema). Each CALL SITE is
//     one STRUCTURED_SHAPES entry — an agent with more than one possible schema
//     (e.g. the classifier with/without suggestions) gets one entry per shape,
//     and call sites that share a schema (the wizard's generate/refine pairs)
//     are separated by a marker sliced out of their own template. Adding one is
//     mechanical and the match can't drift because both halves are derived from
//     the app's own renderer and its own prompt pack.
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
    newFactions: [],
    memberships: [],
    renames: [],
    placements: [],
    standings: [],
    newThreads: [],
    threadStatuses: [],
    knownAwareness: [],
  },
  // The same agent with the story's classifierMentionedPlaces on: the schema grows `newPlaces`,
  // so the injected TS block no longer matches the base entry. Inert for the same reason.
  'periodic-classifier-places': {
    happenings: [],
    relationships: [],
    statusFlips: [],
    newCharacters: [],
    newFactions: [],
    memberships: [],
    renames: [],
    placements: [],
    standings: [],
    newThreads: [],
    threadStatuses: [],
    knownAwareness: [],
    newPlaces: [],
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

  // Wizard assist. Nothing here is written until the user imports it, so the
  // inertness rule the classifier defaults follow does not apply — and could
  // not be met anyway: the list schemas require at least one row. What these
  // are instead is minimal and unmistakably mock-shaped, so a spec asserting on
  // wizard content is obviously reading a default it forgot to override.
  // sceneEntities / currentLocationId stay empty: a fixture's placeholders are
  // allocated per call, so no shared default can name one.
  'wizard-genre': { label: 'Mock genre', promptBody: 'Mock genre body.' },
  'wizard-genre-refine': { label: 'Mock genre', promptBody: 'Mock genre body, revised.' },
  'wizard-tone': { label: 'Mock tone', promptBody: 'Mock tone body.' },
  'wizard-tone-refine': { label: 'Mock tone', promptBody: 'Mock tone body, revised.' },
  'wizard-setting': { setting: 'Mock setting.' },
  'wizard-setting-refine': { setting: 'Mock setting, revised.' },
  'wizard-lore': { lore: [{ title: 'Mock lore', body: 'Mock lore body.', category: '' }] },
  'wizard-cast': {
    entities: [
      { kind: 'character', name: 'Mock Character', description: 'Mock.', status: 'active' },
    ],
  },
  'wizard-opening': {
    prose: 'Mock opening.',
    sceneEntities: [],
    currentLocationId: null,
    worldTime: 0,
  },
  'wizard-opening-refine': {
    prose: 'Mock opening, revised.',
    sceneEntities: [],
    currentLocationId: null,
    worldTime: 0,
  },
  'wizard-title-chips': { titles: ['Mock Title'] },
  'wizard-description': { description: 'Mock description.' },
  'wizard-description-refine': { description: 'Mock description, revised.' },
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
  /** Finish any held narrative streams with the current narrative; a pending cut applies. */
  releaseNarrative: () => void
  /**
   * One-shot: the next structured call matching the `agentName` shape is recorded in `requests`,
   * then held unanswered until releaseStructured() or a client abort (the in-flight window).
   */
  holdNextStructured: (agentName: string) => void
  /** Answer every held structured call with its shape's reply as set now. */
  releaseStructured: () => void
  /** One-shot: the next stream to finish (held: at release) sends the narrative, then 'length'. */
  cutNextNarrative: () => void
  /** One-shot: the next `agentName` call answered (held: at release) sends `raw`, then 'length'. */
  cutNextStructured: (agentName: string, raw: string) => void
  /** Every completion request received, in order. */
  requests: MockRequest[]
  close: () => Promise<void>
}

const DEFAULT_NARRATIVE =
  'The blade rasps free of its sheath. Somewhere in the drowned city, a bell answers, and the rain leans closer to listen.'

// The role frame alone holds a stream open (the cancel test's in-flight window); the tail
// (content, finish frame, [DONE]) completes it.
function narrativeTail(content: string, finishReason: FinishReason): string {
  return contentFrame(content) + stopFrames(finishReason)
}

function narrativeSse(content: string, finishReason: FinishReason): string {
  return roleFrame() + narrativeTail(content, finishReason)
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

/** A recorded request's prompt as the mock matched it: every message's text, in order. */
export function promptOf(request: MockRequest): string {
  return promptText(request.body)
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
  let holdStructuredNext: string | null = null
  // res → shape name to answer with; a client abort drops it, like heldResponses.
  const heldStructured = new Map<ServerResponse, string>()
  let cutNarrativeNext = false
  // Shape name → the raw reply its next answered call sends.
  const cutStructured = new Map<string, string>()

  // Spent by the next stream to finish, so a held stream released later takes it.
  const narrativeFinish = (): FinishReason => {
    if (!cutNarrativeNext) return 'stop'
    cutNarrativeNext = false
    return 'length'
  }

  // The renderer fetches cross-origin (its own origin → this server), which
  // triggers a CORS preflight; answer it and tag every response, so the call
  // isn't blocked in dev (http origin) the way it would be without headers.
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': '*',
  }

  const answerStructured = (res: ServerResponse, agentName: string | null): void => {
    res.writeHead(200, { ...cors, 'content-type': 'application/json' })
    if (agentName === null) {
      res.end(completionBody('{}', 'stop'))
      return
    }
    const cut = cutStructured.get(agentName)
    cutStructured.delete(agentName)
    res.end(
      cut !== undefined
        ? completionBody(cut, 'length')
        : completionBody(JSON.stringify(overrides.get(agentName) ?? EXAMPLES[agentName]), 'stop'),
    )
  }

  const releaseHeldStructured = (): void => {
    const held = [...heldStructured]
    heldStructured.clear()
    for (const [res, agentName] of held) answerStructured(res, agentName)
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
          res.write(roleFrame())
          heldResponses.add(res)
          res.on('close', () => heldResponses.delete(res))
          return
        }
        res.end(narrativeSse(narrative, narrativeFinish()))
        return
      }

      const text = promptText(body)
      const agent = matchShape(null, text)
      requests.push({ body, streamed, agent: agent?.name ?? null })
      if (agent !== null && agent.name === holdStructuredNext) {
        holdStructuredNext = null
        heldStructured.set(res, agent.name)
        res.on('close', () => heldStructured.delete(res))
        return
      }
      answerStructured(res, agent?.name ?? null)
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
      for (const res of heldResponses) res.end(narrativeTail(narrative, narrativeFinish()))
      heldResponses.clear()
    },
    holdNextStructured: (agentName) => {
      holdStructuredNext = agentName
    },
    releaseStructured: releaseHeldStructured,
    cutNextNarrative: () => {
      cutNarrativeNext = true
    },
    cutNextStructured: (agentName, raw) => {
      cutStructured.set(agentName, raw)
    },
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        // Finish held calls first, else an open socket hangs server.close().
        for (const res of heldResponses) res.end(narrativeTail(narrative, narrativeFinish()))
        heldResponses.clear()
        releaseHeldStructured()
        server.close(() => resolve())
      }),
  }
}
