import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { httpCallSink } from './http-call-sink'
import { setHttpCallKnownSecretValues } from './http-redaction'
import { __resetDiagnosticsGate, configureDiagnosticsGate } from '../core/gate'
import { diagnosticsStore } from '../core/store'

describe('httpCallSink', () => {
  beforeEach(() => {
    diagnosticsStore.getState().__reset()
    __resetDiagnosticsGate()
    configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => true })
    setHttpCallKnownSecretValues([])
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    setHttpCallKnownSecretValues([])
  })

  it('does beginCall/completeCall roundtrip with stable id and duration', () => {
    vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'))
    const id = httpCallSink.beginCall({
      method: 'POST',
      url: 'https://api.example.test/v1/chat',
      requestHeaders: { authorization: 'Bearer public' },
      requestBody: { hello: 'world' },
      source: 'openai',
      actionId: 'act-1',
    })

    const rowBefore = diagnosticsStore.getState().httpCalls[0]
    expect(rowBefore.id).toBe(id)
    expect(rowBefore.state).toBe('in_flight')

    vi.setSystemTime(new Date('2026-01-01T12:00:01.250Z'))
    httpCallSink.completeCall(id, {
      status: 200,
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: { ok: true },
      streamed: true,
      source: 'openai',
    })

    const rowAfter = diagnosticsStore.getState().httpCalls[0]
    expect(rowAfter).not.toBe(rowBefore)
    expect(rowAfter.id).toBe(rowBefore.id)
    expect(rowAfter.state).toBe('completed')
    expect(rowAfter.durationMs).toBe(1250)
    expect(rowAfter.status).toBe(200)
    expect(rowAfter.source).toBe('openai')
    expect(rowAfter.streamed).toBe(true)
  })

  it('replaces the selected row object while keeping the same row id', () => {
    const id = httpCallSink.beginCall({
      method: 'GET',
      url: 'https://api.example.test/v1/models',
      requestHeaders: {},
    })
    const selectedBefore = diagnosticsStore.getState().httpCalls.find((row) => row.id === id)
    expect(selectedBefore).toBeDefined()

    httpCallSink.completeCall(id, { status: 200, responseHeaders: {} })

    const selectedAfter = diagnosticsStore.getState().httpCalls.find((row) => row.id === id)
    expect(selectedAfter).toBeDefined()
    expect(selectedAfter).not.toBe(selectedBefore)
    expect(selectedAfter?.id).toBe(selectedBefore?.id)
  })

  it('does beginCall/failCall roundtrip with failed state and duration', () => {
    vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'))
    const id = httpCallSink.beginCall({
      method: 'GET',
      url: 'https://api.example.test/v1/models',
      requestHeaders: {},
    })

    vi.setSystemTime(new Date('2026-01-01T12:00:00.300Z'))
    httpCallSink.failCall(id, new Error('request failed'))

    const row = diagnosticsStore.getState().httpCalls[0]
    expect(row.state).toBe('failed')
    expect(row.error).toBe('request failed')
    expect(row.durationMs).toBe(300)
  })

  it('is a no-op while diagnostics are disabled', () => {
    configureDiagnosticsGate({ isEnabled: () => false, isDebugEnabled: () => false })
    const id = httpCallSink.beginCall({
      method: 'GET',
      url: 'https://api.example.test/v1/models',
      requestHeaders: {},
    })

    httpCallSink.completeCall(id, {
      status: 200,
      responseHeaders: {},
    })

    expect(diagnosticsStore.getState().httpCalls).toEqual([])
  })

  it('skips redaction and body snapshot work while diagnostics are disabled', () => {
    configureDiagnosticsGate({ isEnabled: () => false, isDebugEnabled: () => false })
    const throwingRequestBody = {
      toJSON() {
        throw new Error('snapshot should not run')
      },
    }

    let id = ''
    expect(() => {
      id = httpCallSink.beginCall({
        method: 'GET',
        url: 'http://%',
        requestHeaders: {},
        requestBody: throwingRequestBody,
      })
    }).not.toThrow()

    expect(() =>
      httpCallSink.completeCall(id, {
        status: 200,
        responseHeaders: {},
      }),
    ).not.toThrow()
    expect(diagnosticsStore.getState().httpCalls).toEqual([])
  })

  it('redacts headers and URL before writing while preserving set-cookie in response', () => {
    setHttpCallKnownSecretValues(['sk-secret', '123'])
    const id = httpCallSink.beginCall({
      method: 'GET',
      url: 'https://api.example.test/v1/models?api_key=sk-secret&trace=req-123-abc',
      requestHeaders: {
        authorization: 'Bearer sk-secret',
        'x-short-key': 'req-123-abc',
      },
    })

    httpCallSink.completeCall(id, {
      status: 200,
      responseHeaders: {
        'x-token': 'sk-secret',
        'set-cookie': 'sk-secret',
      },
    })

    const row = diagnosticsStore.getState().httpCalls[0]
    expect(row.url).toBe('https://api.example.test/v1/models?api_key=***&trace=req-123-abc')
    expect(row.requestHeaders).toEqual({
      authorization: '***',
      'x-short-key': 'req-123-abc',
    })
    expect(row.responseHeaders).toEqual({
      'x-token': '***',
      'set-cookie': 'sk-secret',
    })
  })

  it('caps at 200 and evicts oldest completed rows while preserving in-flight rows', () => {
    const firstInFlightId = httpCallSink.beginCall({
      method: 'GET',
      url: 'https://api.example.test/first-in-flight',
      requestHeaders: {},
    })

    for (let i = 0; i < 199; i += 1) {
      const id = httpCallSink.beginCall({
        method: 'GET',
        url: `https://api.example.test/completed-${i}`,
        requestHeaders: {},
      })
      httpCallSink.completeCall(id, { status: 200, responseHeaders: {} })
    }

    expect(diagnosticsStore.getState().httpCalls).toHaveLength(200)

    const overflowId = httpCallSink.beginCall({
      method: 'GET',
      url: 'https://api.example.test/overflow',
      requestHeaders: {},
    })

    const rows = diagnosticsStore.getState().httpCalls
    expect(rows).toHaveLength(200)
    expect(rows.some((row) => row.id === firstInFlightId)).toBe(true)
    expect(rows.some((row) => row.url === 'https://api.example.test/completed-0')).toBe(false)
    expect(rows.some((row) => row.id === overflowId)).toBe(true)
  })

  it('snapshots mutable request and response bodies before storing', () => {
    const requestBody = { nested: { value: 1 } }
    const id = httpCallSink.beginCall({
      method: 'POST',
      url: 'https://api.example.test/v1/chat',
      requestHeaders: {},
      requestBody,
    })

    requestBody.nested.value = 2

    const responseBody = { usage: { tokens: 100 } }
    httpCallSink.completeCall(id, {
      status: 200,
      responseHeaders: {},
      responseBody,
    })
    responseBody.usage.tokens = 200

    const row = diagnosticsStore.getState().httpCalls.find((candidate) => candidate.id === id)
    expect(row?.requestBody).toEqual({ nested: { value: 1 } })
    expect(row?.responseBody).toEqual({ usage: { tokens: 100 } })
  })
})
