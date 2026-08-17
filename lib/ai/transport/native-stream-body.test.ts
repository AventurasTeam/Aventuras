import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { streamText } from 'ai'
import { describe, expect, it } from 'vitest'

import { describeProviderError } from './classify-provider-error'
import { createFetchWithCapture } from './fetch'

// React Native's global fetch is `require('whatwg-fetch')` — an XHR-based
// polyfill whose Response exposes no `body` getter at all. Every SSE streaming
// call therefore reaches the SDK's event-source handler with `response.body ==
// null`, which is issue #394's `Failed to process successful response`.
function bodylessEventStreamFetch(): typeof fetch {
  return () =>
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      // Absent, not null: whatwg-fetch declares no `body` getter whatsoever, so
      // the capture wrapper's `!== null` guard passes while the SDK's `== null`
      // check trips. Both branches must end in the same error.
      url: 'https://inference.test/v1/chat/completions',
      clone() {
        return this
      },
      text: () => Promise.resolve(''),
    } as unknown as Response)
}

function streamErrorOf(fetchImpl: typeof fetch): Promise<unknown> {
  const model = createOpenAICompatible({
    name: 'local',
    baseURL: 'https://inference.test/v1',
    fetch: createFetchWithCapture({ source: 'test', fetchImpl }),
  })('local-model')

  return new Promise((resolve) => {
    const result = streamText({
      model,
      prompt: 'P',
      maxRetries: 0,
      onError: ({ error }) => resolve(error),
    })
    // fullStream terminates silently on a stream failure — onError is the only
    // signal, exactly as per-turn's narrative phase relies on.
    void (async () => {
      for await (const _ of result.fullStream) void _
      resolve(undefined)
    })()
  })
}

describe('a response with no body stream (React Native fetch shape)', () => {
  it('fails the stream with an empty-body cause under the SDK envelope', async () => {
    const error = await streamErrorOf(bodylessEventStreamFetch())

    // The envelope alone is what issue #394 surfaced; the cause names the fault.
    expect(describeProviderError(error)).toBe(
      'APICallError: Failed to process successful response ← EmptyResponseBodyError: Empty response body',
    )
  })

  it('streams normally when the response carries a body', async () => {
    const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`
    const chunks = [
      sse({
        id: 'c',
        choices: [{ index: 0, delta: { role: 'assistant', content: 'Hi' }, finish_reason: null }],
      }),
      sse({ id: 'c', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
      'data: [DONE]\n\n',
    ]

    const withBody: typeof fetch = () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (const c of chunks) controller.enqueue(new TextEncoder().encode(c))
              controller.close()
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
      )

    expect(await streamErrorOf(withBody)).toBeUndefined()
  })
})
