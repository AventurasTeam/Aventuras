import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { z } from 'zod'

import { parseStateBlock, parseSuggestionsBlock, stripTrailingBlocks } from '@/lib/piggyback'

import { readBody } from './completions'
import { laneCatalog, type MockContext } from './context'
import { NARRATIVE_LANE } from './routing'
import { STRUCTURED_SHAPES } from './shapes'
import { defaultState, flushState, laneSchema, upstreamSchema, type CannedResponse } from './state'
import { validateLaneValue } from './validate'

// No CORS headers anywhere in this file: the panel is served from this same
// origin, and the request log carries whole prompts — a page in another tab
// must not be able to read it or re-arm a lane.
function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(value))
}

function snapshot(ctx: MockContext) {
  return {
    lanes: laneCatalog(ctx).map((meta) => ({ ...meta, lane: ctx.lane(meta.key) })),
    upstreams: ctx.state.upstreams.map((u) => ({
      ...u,
      // Names only — the key itself never crosses this boundary.
      apiKeyPresent: u.apiKeyEnv !== '' && process.env[u.apiKeyEnv] !== undefined,
    })),
    shapes: STRUCTURED_SHAPES.map((s) => ({ name: s.name, block: s.block })),
    discovered: [...ctx.discovered.values()],
  }
}

/** Rebuilds an authored value from what a call actually served. */
function recordedValue(laneKey: string, served: unknown): unknown {
  if (laneKey !== NARRATIVE_LANE) {
    if (typeof served !== 'string') return served
    try {
      return JSON.parse(served)
    } catch {
      return served
    }
  }

  const raw = typeof served === 'string' ? served : ''
  const { prose } = stripTrailingBlocks(raw)
  const state = parseStateBlock(raw)
  const suggestions = parseSuggestionsBlock(raw)
  return {
    prose,
    ...(state.blockFound ? { state: state.block } : {}),
    ...(suggestions.blockFound ? { suggestions: suggestions.items } : {}),
  }
}

function sendEvents(req: IncomingMessage, res: ServerResponse, ctx: MockContext): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  res.write(': connected\n\n')
  const unsubscribe = ctx.log.subscribe((entry) => {
    res.write(`data: ${JSON.stringify(entry)}\n\n`)
  })
  // Proxies and browsers drop an idle event-stream; a comment frame is the
  // cheapest thing that counts as traffic.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000)
  req.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe()
  })
}

export async function handleControl(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: MockContext,
  pathname: string,
): Promise<void> {
  const segments = pathname.split('/').filter(Boolean).slice(1)
  const method = req.method ?? 'GET'
  const body = async (): Promise<Record<string, unknown>> => {
    const raw = await readBody(req)
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  }
  const commit = (): void => {
    ctx.save()
    json(res, 200, snapshot(ctx))
  }

  if (segments[0] === 'state' && method === 'GET') return json(res, 200, snapshot(ctx))

  if (segments[0] === 'events' && method === 'GET') return sendEvents(req, res, ctx)

  if (segments[0] === 'log') {
    if (method === 'GET') return json(res, 200, ctx.log.list())
    if (method === 'DELETE') {
      ctx.log.clear()
      return json(res, 200, { ok: true })
    }
    // /api/log/:id/save
    const entry = segments[1] !== undefined ? ctx.log.find(segments[1]) : undefined
    if (segments[2] === 'save' && method === 'POST') {
      if (entry === undefined) return json(res, 404, { error: 'no such log entry' })
      const payload = await body()
      const value = recordedValue(entry.lane, entry.served)
      const check = validateLaneValue(entry.lane, value)
      if (!check.ok) return json(res, 400, { error: check.error })
      const canned: CannedResponse = {
        id: `r_${randomUUID().slice(0, 8)}`,
        name: typeof payload.name === 'string' ? payload.name : 'Recorded',
        value,
      }
      const lane = ctx.lane(entry.lane)
      lane.responses.push(canned)
      lane.sequence.ids.push(canned.id)
      lane.activeId ??= canned.id
      return commit()
    }
  }

  if (segments[0] === 'upstreams' && method === 'PUT') {
    const payload = await body()
    const parsed = z.array(upstreamSchema).safeParse(payload.upstreams)
    if (!parsed.success) return json(res, 400, { error: parsed.error.message })
    ctx.state.upstreams = parsed.data
    return commit()
  }

  if (segments[0] === 'lanes' && segments[1] !== undefined) {
    const key = decodeURIComponent(segments[1])
    const lane = ctx.lane(key)

    if (segments[2] === undefined && method === 'PUT') {
      const payload = await body()
      // Merged into a candidate and validated whole before it touches the lane:
      // an unchecked patch persists to state.json and the next boot refuses to
      // load it, so the panel would break the server it configures.
      const candidate: Record<string, unknown> = { ...lane }
      for (const field of ['mode', 'upstreamId', 'activeId'] as const) {
        if (field in payload) candidate[field] = payload[field]
      }
      for (const group of ['sequence', 'delay', 'failure', 'stream'] as const) {
        if (!(group in payload)) continue
        const patch = payload[group]
        candidate[group] =
          typeof patch === 'object' && patch !== null && !Array.isArray(patch)
            ? { ...lane[group], ...patch }
            : patch
      }
      const parsed = laneSchema.safeParse(candidate)
      if (!parsed.success) return json(res, 400, { error: parsed.error.message })
      Object.assign(lane, parsed.data)
      return commit()
    }

    if (segments[2] === 'sequence' && segments[3] === 'reset' && method === 'POST') {
      lane.sequence.cursor = 0
      return commit()
    }

    if (segments[2] === 'responses') {
      const payload = method === 'DELETE' ? {} : await body()

      if (segments[3] === undefined && method === 'POST') {
        const check = validateLaneValue(key, payload.value)
        if (!check.ok) return json(res, 400, { error: check.error })
        const canned: CannedResponse = {
          id: `r_${randomUUID().slice(0, 8)}`,
          name: typeof payload.name === 'string' ? payload.name : 'Untitled',
          value: payload.value,
        }
        lane.responses.push(canned)
        lane.sequence.ids.push(canned.id)
        lane.activeId ??= canned.id
        return commit()
      }

      const id = segments[3]
      const index = lane.responses.findIndex((r) => r.id === id)
      if (index === -1) return json(res, 404, { error: 'no such response' })

      if (method === 'PUT') {
        if ('value' in payload) {
          const check = validateLaneValue(key, payload.value)
          if (!check.ok) return json(res, 400, { error: check.error })
        }
        const existing = lane.responses[index] as CannedResponse
        lane.responses[index] = {
          ...existing,
          ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
          ...('value' in payload ? { value: payload.value } : {}),
        }
        return commit()
      }

      if (method === 'DELETE') {
        lane.responses.splice(index, 1)
        lane.sequence.ids = lane.sequence.ids.filter((r) => r !== id)
        if (lane.activeId === id) lane.activeId = lane.responses[0]?.id ?? null
        return commit()
      }
    }
  }

  if (segments[0] === 'bulk' && method === 'POST') {
    const payload = await body()
    for (const lane of Object.values(ctx.state.lanes)) {
      if (payload.mode === 'mock' || payload.mode === 'passthrough') lane.mode = payload.mode
      if (payload.resetSequences === true) lane.sequence.cursor = 0
      if (payload.clearFailures === true) lane.failure.kind = 'none'
    }
    return commit()
  }

  if (segments[0] === 'reset' && method === 'POST') {
    Object.assign(ctx.state, defaultState())
    flushState(ctx.state)
    return json(res, 200, snapshot(ctx))
  }

  json(res, 404, { error: `no control route for ${method} ${pathname}` })
}
