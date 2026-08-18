import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { MockContext } from './context'
import { extractPlaceholders, type LogEntry } from './log'
import { passthrough } from './passthrough'
import { streamNarrative } from './respond/narrative'
import { hasStateContent, renderNarrative, type NarrativeValue } from './respond/tagged-block'
import { CORS_HEADERS, SSE_HEADERS, completionBody, errorBody, roleFrame } from './respond/wire'
import { classifyRequest, laneKeyOf, promptText, NARRATIVE_LANE } from './routing'
import { nextResponse, takeFailure, type FailureKind, type Lane } from './state'

const PER_TURN_CLASSIFIER_LANES = new Set([
  'per-turn-classifier',
  'per-turn-classifier-suggestions',
])

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function jittered(base: number, jitter: number): number {
  if (jitter <= 0) return base
  return Math.max(0, base + (Math.random() * 2 - 1) * jitter)
}

// Content present but nothing extractable: the app's parser reports a field
// failure rather than "nothing to report", which is the piggyback recovery path.
const TRUNCATED_STATE_BLOCK = '\n\n<state>\n  <transfers><item id='

// Prose, not truncated JSON: generateStructured runs the reply through
// jsonrepair before validating, and repaired truncation can land on a value a
// schema whose fields all carry defaults accepts. A refusal fails every object
// schema, and is what a real model actually emits when it declines.
const MALFORMED_STRUCTURED = "I'm sorry, I can't produce that JSON."

function asNarrativeValue(value: unknown): NarrativeValue {
  if (typeof value === 'string') return { prose: value }
  const record = (value ?? {}) as Partial<NarrativeValue>
  return {
    prose: typeof record.prose === 'string' ? record.prose : '',
    ...(record.state !== undefined ? { state: record.state } : {}),
    ...(record.suggestions !== undefined ? { suggestions: record.suggestions } : {}),
  }
}

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function sendHttpFailure(res: ServerResponse, status: number): void {
  res.writeHead(status, { ...CORS_HEADERS, 'content-type': 'application/json' })
  res.end(errorBody(`mock injected HTTP ${status}`))
}

function resolveUpstream(ctx: MockContext, lane: Lane) {
  if (lane.mode !== 'passthrough') return null
  return ctx.state.upstreams.find((u) => u.id === lane.upstreamId) ?? null
}

// Not the whole story on its own — a narrative that carried <state> and is
// still followed by a classifier call means the piggyback fold did not take,
// most often because the resolved narrative model has no taggedBlockReliable
// capability. Without this the fallback path looks identical to the real one.
function piggybackNote(ctx: MockContext, key: string): string | undefined {
  if (!PER_TURN_CLASSIFIER_LANES.has(key)) return undefined
  if (ctx.log.lastNarrativeHadState === true)
    return 'fallback classifier fired even though the narrative carried <state> — check taggedBlockReliable on the resolved narrative model'
  if (ctx.log.lastNarrativeHadState === false)
    return 'fallback classifier fired because the narrative carried no <state> block'
  return undefined
}

export async function handleCompletion(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: MockContext,
): Promise<void> {
  const startedAt = Date.now()
  const raw = await readBody(req)
  let body: Record<string, unknown>
  try {
    body = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>
  } catch {
    // The caller's error, not the mock's — a 500 reads as the mock falling over.
    res.writeHead(400, { ...CORS_HEADERS, 'content-type': 'application/json' })
    res.end(errorBody('mock could not parse the request body as JSON', 'invalid_request_error'))
    return
  }

  const route = classifyRequest(body)
  const key = laneKeyOf(route)
  const streamed = route.lane === NARRATIVE_LANE

  if (route.lane === 'structured' && route.shape === null && !ctx.discovered.has(key)) {
    ctx.discovered.set(key, { key, block: route.block, firstSeenAt: Date.now() })
  }

  const lane = ctx.lane(key)
  const prompt = promptText(body)

  const controller = new AbortController()
  let clientGone = false
  // Not req 'close': IncomingMessage closes as soon as the body has arrived, so
  // a listener attached after readBody never fires. writableFinished separates
  // a reply that completed from a client that walked away mid-call.
  res.on('close', () => {
    if (res.writableFinished) return
    clientGone = true
    controller.abort()
  })

  const note = piggybackNote(ctx, key)
  const entry: LogEntry = {
    id: randomUUID(),
    at: startedAt,
    lane: key,
    shapeName: route.lane === 'structured' ? (route.shape?.name ?? null) : null,
    block: route.lane === 'structured' ? route.block : null,
    mode: lane.mode,
    streamed,
    outcome: 'ok',
    status: 200,
    durationMs: 0,
    prompt,
    served: null,
    placeholders: extractPlaceholders(prompt),
    ...(note !== undefined ? { note } : {}),
  }

  const finish = (): void => {
    entry.durationMs = Date.now() - startedAt
    if (clientGone && entry.outcome === 'ok') entry.outcome = 'aborted'
    ctx.log.push(entry)
    ctx.save()
  }

  await sleep(jittered(lane.delay.ttfbMs, lane.delay.jitterMs))
  if (clientGone) {
    entry.outcome = 'aborted'
    finish()
    return
  }

  // Spent only once the call is going to be answered: a budget claimed by a
  // request abandoned during the delay leaves the lane looking armed while the
  // next call sails through.
  const failure: FailureKind = takeFailure(lane)
  if (failure !== 'none') {
    entry.failureKind = failure
    entry.outcome = 'failed'
  }

  if (failure === 'http') {
    entry.status = lane.failure.status
    sendHttpFailure(res, lane.failure.status)
    finish()
    return
  }

  if (failure === 'hang') {
    // Opened but never finished: the deterministic in-flight window a cancel or
    // timeout test needs. The socket is released when the client gives up.
    if (streamed) {
      res.writeHead(200, SSE_HEADERS)
      res.write(roleFrame())
    } else {
      res.writeHead(200, { ...CORS_HEADERS, 'content-type': 'application/json' })
    }
    res.on('close', finish)
    return
  }

  const upstream = resolveUpstream(ctx, lane)
  if (upstream !== null) {
    const result = await passthrough({ upstream, body, res, signal: controller.signal })
    entry.status = result.status
    entry.served = result.content
    entry.responseName = `${upstream.label} (${upstream.model})`
    if (result.error !== undefined) entry.outcome = 'failed'
    if (streamed) ctx.log.lastNarrativeHadState = result.content.includes('<state>')
    finish()
    return
  }

  if (lane.mode === 'passthrough') {
    entry.outcome = 'failed'
    entry.status = 503
    entry.note = 'lane is set to passthrough but has no upstream selected'
    res.writeHead(503, { ...CORS_HEADERS, 'content-type': 'application/json' })
    res.end(
      errorBody(
        'mock lane is set to passthrough but no upstream is selected',
        'mock_lane_misconfigured',
      ),
    )
    finish()
    return
  }

  const canned = nextResponse(lane)
  if (canned !== null) entry.responseName = canned.name

  if (streamed) {
    const value = asNarrativeValue(canned?.value)
    const content =
      failure === 'malformed'
        ? renderNarrative(value) + TRUNCATED_STATE_BLOCK
        : renderNarrative(value)

    ctx.log.lastNarrativeHadState = failure === 'malformed' || hasStateContent(value.state)
    entry.served = content

    res.writeHead(200, SSE_HEADERS)
    await streamNarrative(res, {
      content,
      charsPerSecond: lane.stream.charsPerSecond,
      chunkSize: lane.stream.chunkSize,
      jitterMs: lane.delay.jitterMs,
      ...(failure === 'stream-cut' ? { cut: true } : {}),
      aborted: () => clientGone,
    })
    finish()
    return
  }

  // An unconfigured structured lane answers `{}` rather than 404 — the same
  // contract the E2E mock uses, so a schema with defaults still parses.
  const value = canned?.value ?? {}
  const broken = failure === 'malformed' || failure === 'stream-cut'
  const content = broken ? MALFORMED_STRUCTURED : JSON.stringify(value)

  entry.served = broken ? content : value
  res.writeHead(200, { ...CORS_HEADERS, 'content-type': 'application/json' })
  res.end(completionBody(content))
  finish()
}
