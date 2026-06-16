import { generateText } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getModel } from './model'
import {
  findTemporaryProvider,
  resetTemporaryProvidersForTests,
  setTemporaryProvidersForTests,
} from './stub/temporary-registry'

const sink = vi.hoisted(() => ({
  beginCall: vi.fn(() => 'call-1'),
  completeCall: vi.fn(),
  failCall: vi.fn(),
}))

const setHttpCallKnownSecretValues = vi.hoisted(() => vi.fn())

vi.mock('@/lib/diagnostics', () => ({
  httpCallSink: sink,
  setHttpCallKnownSecretValues,
}))

const appSettings = vi.hoisted(() => ({ providers: [] as unknown[] }))
vi.mock('@/lib/stores', () => ({
  appSettingsStore: { getAppSettings: () => appSettings },
}))

describe('getModel', () => {
  beforeEach(() => {
    appSettings.providers = []
    resetTemporaryProvidersForTests()
    sink.beginCall.mockClear()
    sink.completeCall.mockClear()
    sink.failCall.mockClear()
    setHttpCallKnownSecretValues.mockClear()
    vi.restoreAllMocks()
  })

  it('publishes provider secrets to diagnostics redaction', () => {
    setTemporaryProvidersForTests([
      {
        id: 'anthropic-test',
        type: 'anthropic',
        displayName: 'Anthropic Test',
        apiKey: 'sk-ant-secret',
        favoriteModelIds: ['claude-3-haiku-20240307'],
      },
      {
        id: 'openai-test',
        type: 'openai',
        displayName: 'OpenAI Test',
        apiKey: 'sk-openai-secret',
        favoriteModelIds: ['gpt-4o-mini'],
      },
    ])

    expect(setHttpCallKnownSecretValues).toHaveBeenLastCalledWith([
      'sk-ant-secret',
      'sk-openai-secret',
    ])
    expect(findTemporaryProvider('anthropic-test')).toMatchObject({
      id: 'anthropic-test',
      type: 'anthropic',
    })
  })

  it('returns an Anthropic language model with provider and modelId fields', () => {
    setTemporaryProvidersForTests([
      {
        id: 'anthropic-test',
        type: 'anthropic',
        displayName: 'Anthropic Test',
        apiKey: 'sk-ant-secret',
        favoriteModelIds: ['claude-3-haiku-20240307'],
      },
    ])

    const modelId = 'claude-3-haiku-20240307'
    const model = getModel('anthropic-test', modelId)

    expect(model).toMatchObject({
      modelId,
      provider: 'anthropic.messages',
      specificationVersion: 'v3',
    })
  })

  it('resolves a real openai-compatible provider from app settings', () => {
    appSettings.providers = [
      {
        id: 'prov-real',
        type: 'openai-compatible',
        displayName: 'Local',
        apiKey: 'sk-real',
        endpoint: 'http://localhost:1234/v1',
        favoriteModelIds: [],
      },
    ]
    const model = getModel('prov-real', 'my-model')
    expect(model).toBeDefined()
  })

  it('throws a clear error when the provider is missing', () => {
    expect(() => getModel('missing-provider', 'claude-3-haiku-20240307')).toThrow(
      'Provider "missing-provider" is not configured',
    )
  })

  it('throws a clear error when the provider type is unsupported', () => {
    setTemporaryProvidersForTests([
      {
        id: 'openai-test',
        type: 'openai',
        displayName: 'OpenAI Test',
        apiKey: 'sk-openai-secret',
        favoriteModelIds: ['gpt-4o-mini'],
      },
    ])

    expect(() => getModel('openai-test', 'gpt-4o-mini')).toThrow(
      'Provider type "openai" is not supported in Slice 1.4',
    )
  })

  it('routes Anthropic generateText calls through captured fetch without a real API call', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          type: 'message',
          id: 'msg_123',
          model: 'claude-3-haiku-20240307',
          content: [{ type: 'text', text: 'Hello from the mock.' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 12,
            output_tokens: 5,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )

    setTemporaryProvidersForTests([
      {
        id: 'anthropic-test',
        type: 'anthropic',
        displayName: 'Anthropic Test',
        apiKey: 'sk-ant-secret',
        endpoint: 'https://anthropic.example.test/v1',
        favoriteModelIds: ['claude-3-haiku-20240307'],
      },
    ])

    const result = await generateText({
      model: getModel('anthropic-test', 'claude-3-haiku-20240307'),
      prompt: 'Say hello.',
    })

    expect(result.text).toBe('Hello from the mock.')
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(sink.beginCall).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'provider:anthropic-test',
      }),
    )
    expect(sink.completeCall).toHaveBeenCalledWith(
      'call-1',
      expect.objectContaining({
        status: 200,
      }),
    )
    expect(sink.failCall).not.toHaveBeenCalled()
  })
})
