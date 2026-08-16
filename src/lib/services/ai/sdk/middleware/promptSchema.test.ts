import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import type { JSONSchema7 } from 'json-schema'
import { schemaToTypeScriptBlock } from './promptSchema'

/** The shape the middleware actually receives: whatever Zod emits for the service schema. */
function asJsonSchema(schema: z.ZodType): JSONSchema7 {
  return z.toJSONSchema(schema, { io: 'output' }) as JSONSchema7
}

describe('schemaToTypeScriptBlock', () => {
  it('renders a nullable string as a union, not as unknown', () => {
    // Zod spells `.nullable()` as `anyOf: [string, null]`. Read as a plain `type`, that is
    // no type at all, and the model was handed `unknown` for the field it had to fill.
    const schema = asJsonSchema(z.object({ title: z.string().nullable() }))

    expect(schemaToTypeScriptBlock(schema)).toContain('title: string | null;')
  })

  it('keeps the description alongside the union', () => {
    const schema = asJsonSchema(
      z.object({ locationName: z.string().nullable().describe('Where the scene is').optional() }),
    )

    expect(schemaToTypeScriptBlock(schema)).toContain(
      'locationName?: string | null; // Where the scene is',
    )
  })

  it('renders a nullable enum without losing its members', () => {
    const schema = asJsonSchema(z.object({ status: z.enum(['open', 'shut']).nullable() }))
    const block = schemaToTypeScriptBlock(schema)

    expect(block).toContain('"open"')
    expect(block).toContain('"shut"')
    expect(block).toContain('| null')
  })

  it('still renders plain types', () => {
    const schema = asJsonSchema(
      z.object({ names: z.array(z.string()), count: z.number(), on: z.boolean() }),
    )
    const block = schemaToTypeScriptBlock(schema)

    expect(block).toContain('names: string[];')
    expect(block).toContain('count: number;')
    expect(block).toContain('on: boolean;')
  })

  it('marks optional properties and names the interface', () => {
    const schema = asJsonSchema(z.object({ a: z.string(), b: z.string().optional() }))
    const block = schemaToTypeScriptBlock(schema, 'Response')

    expect(block.startsWith('interface Response {')).toBe(true)
    expect(block).toContain('a: string;')
    expect(block).toContain('b?: string;')
  })
})
