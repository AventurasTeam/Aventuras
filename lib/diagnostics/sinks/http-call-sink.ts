import { redactHeaders, redactResponseHeaders, redactUrl } from './http-redaction'
import { isDiagnosticsEnabled } from '../core/gate'
import { loggerWithoutTurn } from '../core/logger'
import { diagnosticsStore } from '../core/store'
import { ulid } from '../core/ulid'
import type { HttpCall } from '../types'

const HTTP_CALLS_CAP = 200

type BeginCallArgs = {
  method: string
  url: string
  requestHeaders: Record<string, string>
  requestBody?: unknown
  source?: string
  actionId?: string
}

type CompleteCallArgs = {
  status?: number | null
  responseHeaders: Record<string, string>
  responseBody?: unknown
  streamed?: boolean
  source?: string
}

function snapshotBody(value: unknown): unknown {
  if (value === undefined) return undefined

  try {
    return structuredClone(value)
  } catch {
    try {
      return JSON.parse(JSON.stringify(value)) as unknown
    } catch {
      return String(value)
    }
  }
}

function appendHttpCall(row: HttpCall): void {
  diagnosticsStore.setState((state) => {
    if (state.httpCalls.length < HTTP_CALLS_CAP) {
      return { httpCalls: [...state.httpCalls, row] }
    }

    const residentActions = new Set(state.turnCaptures.map((capture) => capture.actionId))
    const evictIdx = state.httpCalls.findIndex(
      (candidate) =>
        candidate.state !== 'in_flight' &&
        (candidate.actionId === undefined || !residentActions.has(candidate.actionId)),
    )

    if (evictIdx === -1) {
      loggerWithoutTurn.debug('provider.http_call_buffer_full', { cap: HTTP_CALLS_CAP })
      return {}
    }

    return {
      httpCalls: [
        ...state.httpCalls.slice(0, evictIdx),
        ...state.httpCalls.slice(evictIdx + 1),
        row,
      ],
    }
  })
}

function finalizeCall(
  id: string,
  update: (row: HttpCall, startedAt: number, now: number) => HttpCall,
): void {
  diagnosticsStore.setState((state) => {
    const idx = state.httpCalls.findIndex((row) => row.id === id)
    if (idx === -1) return {}

    const row = state.httpCalls[idx]
    const now = Date.now()
    const nextRow = update(row, row.startedAt, now)

    return {
      httpCalls: [...state.httpCalls.slice(0, idx), nextRow, ...state.httpCalls.slice(idx + 1)],
    }
  })
}

export const httpCallSink = {
  beginCall(args: BeginCallArgs): string {
    const id = ulid()
    if (!isDiagnosticsEnabled()) return id

    const row: HttpCall = {
      id,
      startedAt: Date.now(),
      method: args.method,
      url: redactUrl(args.url),
      requestHeaders: redactHeaders(args.requestHeaders),
      ...(args.requestBody !== undefined ? { requestBody: snapshotBody(args.requestBody) } : {}),
      ...(args.source !== undefined ? { source: args.source } : {}),
      ...(args.actionId !== undefined ? { actionId: args.actionId } : {}),
      state: 'in_flight',
    }

    appendHttpCall(row)
    return id
  },

  completeCall(id: string, args: CompleteCallArgs): void {
    finalizeCall(id, (row, startedAt, now) => {
      return {
        ...row,
        state: 'completed',
        endedAt: now,
        durationMs: now - startedAt,
        status: args.status,
        responseHeaders: redactResponseHeaders(args.responseHeaders),
        responseBody: snapshotBody(args.responseBody),
        streamed: args.streamed,
        source: args.source ?? row.source,
      }
    })
  },

  failCall(id: string, error: unknown): void {
    finalizeCall(id, (row, startedAt, now) => {
      return {
        ...row,
        state: 'failed',
        endedAt: now,
        durationMs: now - startedAt,
        error: error instanceof Error ? error.message : String(error),
      }
    })
  },
}
