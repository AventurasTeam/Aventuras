import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  jsonResponseFormatMiddleware,
  promptSchemaMiddleware,
  schemaToTypeScriptBlock,
  type JsonSchema,
} from './prompt-schema'

// Mirrors the wizard opening schema's shapes: string, array, nullable, literal.
const schema = z.object({
  prose: z.string().describe('the opening passage'),
  sceneEntities: z.array(z.string()).describe('cast ids present in the scene'),
  currentLocationId: z.string().nullable(),
  worldTime: z.literal(0),
})
const jsonSchema = z.toJSONSchema(schema) as JsonSchema

function userPrompt(text: string) {
  return [{ role: 'user' as const, content: [{ type: 'text' as const, text }] }]
}

async function transform(
  middleware: ReturnType<typeof promptSchemaMiddleware>,
  params: Record<string, unknown>,
) {
  return middleware.transformParams!({
    type: 'generate',
    params: params as never,
    model: {} as never,
  })
}

describe('schemaToTypeScriptBlock', () => {
  it('renders an object schema as a TypeScript interface with descriptions as comments', () => {
    const block = schemaToTypeScriptBlock(jsonSchema)
    expect(block).toContain('interface Response {')
    expect(block).toContain('prose: string; // the opening passage')
    expect(block).toContain('sceneEntities: string[]; // cast ids present in the scene')
    expect(block).toContain('currentLocationId: string | null;')
    expect(block).toContain('worldTime: 0;')
  })

  it('covers every schema key, so a schema edit cannot silently miss the prompt', () => {
    const block = schemaToTypeScriptBlock(jsonSchema)
    for (const key of Object.keys(schema.shape)) {
      expect(block).toContain(key)
    }
  })

  it('renders enums as string-literal unions', () => {
    const block = schemaToTypeScriptBlock(
      z.toJSONSchema(z.object({ mood: z.enum(['dark', 'light']) })) as JsonSchema,
    )
    expect(block).toContain('mood: "dark" | "light";')
  })

  it('parenthesizes a union item type so [] binds to the whole union', () => {
    const block = schemaToTypeScriptBlock(
      z.toJSONSchema(z.object({ tags: z.array(z.string().nullable()) })) as JsonSchema,
    )
    expect(block).toContain('tags: (string | null)[];')
  })
})

describe('promptSchemaMiddleware', () => {
  it('injects the TypeScript block into the last user message and strips responseFormat', async () => {
    const out = await transform(promptSchemaMiddleware(), {
      prompt: userPrompt('Write the opening.'),
      responseFormat: { type: 'json', schema: jsonSchema },
    })
    const text = (out.prompt[0]!.content[0] as { text: string }).text
    expect(text).toContain('Write the opening.')
    expect(text).toContain('interface Response {')
    expect(text).toContain('Output ONLY the JSON object')
    expect(out.responseFormat).toBeUndefined()
  })

  it('passes non-json calls through untouched', async () => {
    const params = { prompt: userPrompt('Write prose.') }
    expect(await transform(promptSchemaMiddleware(), params)).toEqual(params)
  })

  it('falls back to a plain JSON instruction when no schema is declared', async () => {
    const out = await transform(promptSchemaMiddleware(), {
      prompt: userPrompt('x'),
      responseFormat: { type: 'json' },
    })
    const text = (out.prompt[0]!.content[0] as { text: string }).text
    expect(text).toContain('Respond strictly with valid JSON')
    expect(text).not.toContain('interface Response')
  })
})

describe('jsonResponseFormatMiddleware', () => {
  it('declares the json responseFormat with the schema', async () => {
    const out = await transform(jsonResponseFormatMiddleware(jsonSchema), {
      prompt: userPrompt('x'),
    })
    expect(out.responseFormat).toEqual({ type: 'json', schema: jsonSchema })
  })
})
