import { wrapLanguageModel } from 'ai'
import { afterEach } from 'vitest'
import { z } from 'zod'

import type { JsonSchema } from '@/lib/ai'
import { jsonResponseFormatMiddleware, promptSchemaMiddleware } from '@/lib/ai/prompt-schema'
import { createProviderModel } from '@/lib/ai/providers'
import { runProviderCall } from '@/lib/ai/transport/provider-call'
import { fallbackClassifierSchema } from '@/lib/pipeline'

import { STRUCTURED_SHAPES } from './shapes'
import { startMockLlm, type MockLlm } from '../../e2e/harness/mock-llm'

/** One harness per test: the returned function starts it, and it closes after the test. */
export function harnessPerTest(): () => Promise<MockLlm> {
  let mock: MockLlm | undefined
  afterEach(async () => {
    await mock?.close()
    mock = undefined
  })
  return async () => {
    mock = await startMockLlm()
    return mock
  }
}

export function provider(llm: MockLlm): Parameters<typeof createProviderModel>[0] {
  return {
    id: 'prov_harness',
    type: 'openai-compatible',
    displayName: 'Harness',
    apiKey: '',
    favoriteModelIds: [],
    endpoint: llm.url,
  }
}

/** The fallback classifier's shape, so the harness routes it to 'per-turn-classifier'. */
export function classifierCall(llm: MockLlm): ReturnType<typeof runProviderCall> {
  const model = wrapLanguageModel({
    model: createProviderModel(provider(llm), 'mock') as Parameters<
      typeof wrapLanguageModel
    >[0]['model'],
    middleware: [
      jsonResponseFormatMiddleware(z.toJSONSchema(fallbackClassifierSchema) as JsonSchema),
      promptSchemaMiddleware(),
    ],
  }) as Parameters<typeof runProviderCall>[0]['model']
  return runProviderCall({ model, prompt: 'Classify the turn.' })
}

export function blockOf(name: string): string {
  const shape = STRUCTURED_SHAPES.find((s) => s.name === name)
  if (shape === undefined) throw new Error(`no structured shape named ${name}`)
  return shape.block
}

/** A raw request whose prompt carries `name`'s schema block, as the app's auto path sends it. */
export function structuredCall(llm: MockLlm, name: string): Promise<Response> {
  return fetch(`${llm.url}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'mock',
      messages: [
        { role: 'system', content: blockOf(name) },
        { role: 'user', content: 'Classify the turn.' },
      ],
    }),
  })
}
