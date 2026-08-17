import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { schemaToTypeScriptBlock, type JsonSchema } from '@/lib/ai'
// Deep import: the middleware is internal to lib/ai and this test needs the
// real one to prove the extractor tracks the template it renders.
import { promptSchemaMiddleware } from '@/lib/ai/prompt-schema'
import { fallbackClassifierSchema } from '@/lib/pipeline'

import { classifyRequest, extractBlockFromPrompt, matchShape, unknownKey } from './routing'
import { STRUCTURED_SHAPES } from './shapes'

type MiddlewareParams = {
  prompt: { role: string; content: { type: string; text: string }[] }[]
  responseFormat?: { type: 'json'; schema?: JsonSchema }
}

/**
 * Runs the app's own middleware to produce the prompt it would actually send,
 * so a change to SCHEMA_INSTRUCTION_TEMPLATE fails here instead of silently
 * degrading every match at runtime.
 */
async function promptAsSent(schema: z.ZodType): Promise<string> {
  const transform = promptSchemaMiddleware().transformParams
  if (transform === undefined) throw new Error('promptSchemaMiddleware lost transformParams')
  const params: MiddlewareParams = {
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'Classify the turn.' }] }],
    responseFormat: { type: 'json', schema: z.toJSONSchema(schema) as JsonSchema },
  }
  const out = (await transform({
    params,
  } as unknown as Parameters<typeof transform>[0])) as unknown as MiddlewareParams
  return out.prompt[0]?.content.map((p) => p.text).join('\n') ?? ''
}

function requestFrom(text: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { model: 'seed/narrative', messages: [{ role: 'user', content: text }], ...extra }
}

describe('classifyRequest', () => {
  it('routes a streaming call to the narrative lane', () => {
    expect(classifyRequest(requestFrom('anything', { stream: true }))).toEqual({
      lane: 'narrative',
    })
  })

  it('recovers the block the app injects and names the shape', async () => {
    const text = await promptAsSent(fallbackClassifierSchema)

    expect(extractBlockFromPrompt(text)).toBe(
      schemaToTypeScriptBlock(z.toJSONSchema(fallbackClassifierSchema) as JsonSchema),
    )

    const route = classifyRequest(requestFrom(text))
    expect(route).toMatchObject({ lane: 'structured', key: 'per-turn-classifier' })
  })

  it('distinguishes the classifier shape that also asks for suggestions', async () => {
    const withSuggestions = STRUCTURED_SHAPES.find(
      (s) => s.name === 'per-turn-classifier-suggestions',
    )
    if (withSuggestions === undefined) throw new Error('registry lost the suggestions shape')

    const route = classifyRequest(requestFrom(await promptAsSent(withSuggestions.schema)))
    expect(route).toMatchObject({ lane: 'structured', key: 'per-turn-classifier-suggestions' })
  })

  it('matches the force-on path, which sends a JSON Schema instead of a prompt block', () => {
    const route = classifyRequest(
      requestFrom('Classify the turn.', {
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'Response', schema: z.toJSONSchema(fallbackClassifierSchema) },
        },
      }),
    )
    expect(route).toMatchObject({ lane: 'structured', key: 'per-turn-classifier' })
  })

  it('gives an unregistered schema a stable lane key instead of failing', async () => {
    const novel = z.object({ mood: z.string(), intensity: z.number() })
    const text = await promptAsSent(novel)

    const route = classifyRequest(requestFrom(text))
    expect(route.lane).toBe('structured')
    if (route.lane !== 'structured') throw new Error('unreachable')
    expect(route.shape).toBeNull()
    expect(route.key).toMatch(/^unknown:[0-9a-f]{8}$/)
    expect(route.block).toContain('mood: string;')

    // Stable across calls: the UI keys a lane on it.
    expect(classifyRequest(requestFrom(text))).toMatchObject({ key: route.key })
  })

  it('falls back to a no-schema key when nothing declares a shape', () => {
    const route = classifyRequest(requestFrom('just some prose, no schema'))
    expect(route).toMatchObject({ key: 'unknown:no-schema', shape: null, block: null })
    expect(unknownKey(null)).toBe('unknown:no-schema')
  })
})

describe('STRUCTURED_SHAPES', () => {
  it('carries the exact block the app renders for each schema', () => {
    for (const shape of STRUCTURED_SHAPES) {
      expect(shape.block).toBe(schemaToTypeScriptBlock(z.toJSONSchema(shape.schema) as JsonSchema))
    }
  })

  it('has no two shapes sharing a block, which would make a match ambiguous', () => {
    const blocks = STRUCTURED_SHAPES.map((s) => s.block)
    expect(new Set(blocks).size).toBe(blocks.length)
  })

  it('has no block contained in another, which the substring scan relies on', () => {
    for (const a of STRUCTURED_SHAPES) {
      for (const b of STRUCTURED_SHAPES) {
        if (a.name === b.name) continue
        expect(b.block.includes(a.block), `${a.name}'s block is inside ${b.name}'s`).toBe(false)
      }
    }
  })
})

describe('matchShape', () => {
  const inner = { name: 'inner', schema: z.unknown(), block: 'interface Response { a: string }' }
  const outer = {
    name: 'outer',
    schema: z.unknown(),
    block: 'interface Response { a: string } & { b: number }',
  }

  it('prefers the longer block when one nests inside another', () => {
    const text = `prompt text ${outer.block} trailer`
    // Registry order deliberately puts the shorter one first: without the
    // longest-first scan the loose entry would claim a request meant for the
    // more specific schema.
    expect(matchShape(null, text, [inner, outer])?.name).toBe('outer')
  })

  it('takes an exact block match ahead of any substring scan', () => {
    expect(matchShape(inner.block, `${outer.block}`, [inner, outer])?.name).toBe('inner')
  })

  it('names every shape uniquely — overrides and lane keys both key on the name', () => {
    const names = STRUCTURED_SHAPES.map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain('per-turn-classifier')
    expect(names).toContain('periodic-classifier')
    expect(names).toContain('suggestion-refresh')
  })
})
