import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { classifierExtractionSchema } from '@/lib/classifier'
import {
  castSuggestionsSchema,
  descriptionOutputSchema,
  labeledPromptOutputSchema,
  loreSuggestionsSchema,
  openingOutputSchema,
  settingOutputSchema,
  titleChipsSchema,
} from '@/lib/wizard'

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

  it('renders a discriminated union (oneOf) with its per-member fields, not unknown', () => {
    // zod v4 compiles z.discriminatedUnion to JSON Schema `oneOf`, not `anyOf`;
    // this must go through the real z.toJSONSchema conversion, not a hand-written
    // oneOf literal, so a change to zod's emission shape would be caught here too.
    const entitySchema = z.object({
      entities: z.array(
        z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('character'), faction_name: z.string().optional() }),
          z.object({ kind: z.literal('location'), parent_location_name: z.string().optional() }),
        ]),
      ),
    })
    const block = schemaToTypeScriptBlock(z.toJSONSchema(entitySchema) as JsonSchema)
    expect(block).not.toContain('unknown')
    expect(block).toContain('kind: "character"')
    expect(block).toContain('faction_name?: string')
    expect(block).toContain('kind: "location"')
    expect(block).toContain('parent_location_name?: string')
  })
})

describe('structured-output schema net', () => {
  // The generateStructured schemas reachable from a module root — lib/wizard and
  // lib/classifier. The three in lib/pipeline/definitions aren't re-exported from
  // lib/pipeline, so they stay uncovered rather than widening that module's API.
  // None here legitimately renders `unknown`, so an occurrence is a renderer
  // regression rather than an expected shape.
  const structuredOutputSchemas = {
    openingOutputSchema,
    titleChipsSchema,
    descriptionOutputSchema,
    loreSuggestionsSchema,
    labeledPromptOutputSchema,
    settingOutputSchema,
    castSuggestionsSchema,
    classifierExtractionSchema,
  }

  it.each(Object.entries(structuredOutputSchemas))(
    'renders %s without degrading to unknown',
    (name, schema) => {
      const block = schemaToTypeScriptBlock(z.toJSONSchema(schema) as JsonSchema, name)
      expect(block).not.toContain('unknown')
    },
  )
})

// architecture.md → Structured output (contract and closing-line placement).
describe('promptSchemaMiddleware', () => {
  const CONTRACT = `Respond strictly with JSON. The JSON should be compatible with the TypeScript type Response from the following:\n\n${schemaToTypeScriptBlock(jsonSchema)}`
  const CLOSING = 'Output ONLY the JSON object, no other text or markdown.'
  const responseFormat = { type: 'json', schema: jsonSchema }

  it('creates a system message for the contract when the prompt has none', async () => {
    const out = await transform(promptSchemaMiddleware(), {
      prompt: userPrompt('Write the opening.'),
      responseFormat,
    })
    expect(out.prompt).toEqual([
      { role: 'system', content: CONTRACT },
      { role: 'user', content: [{ type: 'text', text: `Write the opening.\n\n${CLOSING}` }] },
    ])
    expect(out.responseFormat).toBeUndefined()
  })

  it('appends the contract to the system half, keeping one system message', async () => {
    const out = await transform(promptSchemaMiddleware(), {
      prompt: [{ role: 'system', content: '# Setting\nA drowned city.' }, ...userPrompt('Go.')],
      responseFormat,
    })
    expect(out.prompt).toEqual([
      { role: 'system', content: `# Setting\nA drowned city.\n\n${CONTRACT}` },
      { role: 'user', content: [{ type: 'text', text: `Go.\n\n${CLOSING}` }] },
    ])
    const system = out.prompt[0] as { content: string }
    expect(system.content.endsWith(schemaToTypeScriptBlock(jsonSchema))).toBe(true)
  })

  it('extends only the last system message, keeping its other fields', async () => {
    const providerOptions = { anthropic: { cacheControl: { type: 'ephemeral' } } }
    const out = await transform(promptSchemaMiddleware(), {
      prompt: [
        { role: 'system', content: 'First.' },
        { role: 'system', content: 'Second.', providerOptions },
        ...userPrompt('Go.'),
      ],
      responseFormat,
    })
    expect(out.prompt.slice(0, 2)).toEqual([
      { role: 'system', content: 'First.' },
      { role: 'system', content: `Second.\n\n${CONTRACT}`, providerOptions },
    ])
  })

  it("keeps the user message's non-text parts after its text", async () => {
    const image = { type: 'file', data: 'aGk=', mediaType: 'image/png' }
    const out = await transform(promptSchemaMiddleware(), {
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Look.' }, image] }],
      responseFormat,
    })
    expect(out.prompt[1]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: `Look.\n\n${CLOSING}` }, image],
    })
  })

  it('adds a user message for the closing line when the prompt has none', async () => {
    const out = await transform(promptSchemaMiddleware(), {
      prompt: [{ role: 'system', content: 'Rules.' }],
      responseFormat,
    })
    expect(out.prompt).toEqual([
      { role: 'system', content: `Rules.\n\n${CONTRACT}` },
      { role: 'user', content: [{ type: 'text', text: CLOSING }] },
    ])
  })

  it('splits the plain JSON instruction the same way when no schema is declared', async () => {
    const out = await transform(promptSchemaMiddleware(), {
      prompt: userPrompt('x'),
      responseFormat: { type: 'json' },
    })
    expect(out.prompt).toEqual([
      { role: 'system', content: 'Respond strictly with valid JSON.' },
      {
        role: 'user',
        content: [{ type: 'text', text: 'x\n\nOutput ONLY the JSON, no other text.' }],
      },
    ])
  })

  it('passes calls with no JSON response format through untouched', async () => {
    const plain = { prompt: userPrompt('Write prose.') }
    expect(await transform(promptSchemaMiddleware(), plain)).toEqual(plain)
    const text = { prompt: userPrompt('Write prose.'), responseFormat: { type: 'text' } }
    expect(await transform(promptSchemaMiddleware(), text)).toEqual(text)
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
