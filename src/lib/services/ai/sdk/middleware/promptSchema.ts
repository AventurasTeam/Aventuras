/**
 * Prompt Schema Middleware
 *
 * For providers/models that don't support response_format (structured outputs),
 * this middleware injects the schema into the prompt as TypeScript-like types
 * and removes response_format from the request.
 *
 * Works with extractJsonMiddleware to parse the output.
 */

import type { TextPart } from 'ai'
import type { LanguageModelV4Message, LanguageModelV4Middleware } from '@ai-sdk/provider'
import type { JSONSchema7, JSONSchema7Type } from 'json-schema'

// ============================================================================
// Schema to TypeScript Conversion
// ============================================================================

function jsonSchemaToTypeScript(schema: JSONSchema7, indent = 0): string {
  const pad = '  '.repeat(indent)
  const padInner = '  '.repeat(indent + 1)

  // Zod spells `.nullable()` as `anyOf: [T, null]`, not as a type array. Everything below
  // keys off `type`, which is absent here, so without this branch every nullable field
  // reaches the model as `unknown`.
  const union = (schema.anyOf ?? schema.oneOf) as JSONSchema7[] | undefined
  if (union?.length) {
    const parts = union.map((variant) =>
      variant.type === 'null' ? 'null' : jsonSchemaToTypeScript(variant, indent),
    )
    return [...new Set(parts)].join(' | ')
  }

  const nullable = Array.isArray(schema.type) && schema.type.includes('null')
  const primaryType = Array.isArray(schema.type)
    ? schema.type.find((t: string) => t !== 'null')
    : schema.type

  function withNullable(type: string): string {
    return nullable ? `${type} | null` : type
  }

  switch (primaryType) {
    case 'string':
      if (schema.enum) {
        const enumValues = schema.enum.map((v: JSONSchema7Type) => `"${v}"`).join(' | ')
        return nullable ? `(${enumValues}) | null` : enumValues
      }
      return withNullable('string')

    case 'number':
    case 'integer':
      return withNullable('number')

    case 'boolean':
      return withNullable('boolean')

    case 'array': {
      const items = schema.items as JSONSchema7 | undefined
      const itemType = items ? jsonSchemaToTypeScript(items, indent) : 'unknown'
      return withNullable(`${itemType}[]`)
    }

    case 'object': {
      if (!schema.properties || Object.keys(schema.properties).length === 0) {
        return withNullable('Record<string, unknown>')
      }

      const required = new Set(schema.required ?? [])
      const props = Object.entries(schema.properties)
        .map(([key, propSchema]) => {
          const propDef = propSchema as JSONSchema7
          const optional = required.has(key) ? '' : '?'
          const propType = jsonSchemaToTypeScript(propDef, indent + 1)
          const description = propDef.description ? ` // ${propDef.description}` : ''
          return `${padInner}${key}${optional}: ${propType};${description}`
        })
        .join('\n')

      return withNullable(`{\n${props}\n${pad}}`)
    }

    default:
      return 'unknown'
  }
}

export function schemaToTypeScriptBlock(schema: JSONSchema7, name = 'Response'): string {
  const typeBody = jsonSchemaToTypeScript(schema, 0)
  if (schema.type === 'object' && schema.properties) {
    return `interface ${name} ${typeBody}`
  }
  return `type ${name} = ${typeBody}`
}

// ============================================================================
// Prompt Injection
// ============================================================================

const SCHEMA_INSTRUCTION_TEMPLATE = `Respond strictly with JSON. The JSON should be compatible with the TypeScript type Response from the following:

{schema}

Output ONLY the JSON object, no other text or markdown.`

const SIMPLE_JSON_INSTRUCTION =
  'Respond strictly with valid JSON. Output ONLY the JSON, no other text.'

function injectSchemaIntoPrompt(
  prompt: Array<LanguageModelV4Message>,
  instruction: string,
): Array<LanguageModelV4Message> {
  const newPrompt = [...prompt]
  const lastUserIdx = newPrompt.findLastIndex((msg) => msg.role === 'user')

  if (lastUserIdx >= 0) {
    const lastUserMsg = newPrompt[lastUserIdx]
    if (lastUserMsg.role === 'user') {
      const textParts = lastUserMsg.content.filter((p) => p.type === 'text')
      const otherParts = lastUserMsg.content.filter((p) => p.type !== 'text')
      const combinedText =
        textParts.map((p) => (p as TextPart).text).join('\n') + '\n\n' + instruction

      newPrompt[lastUserIdx] = {
        ...lastUserMsg,
        content: [{ type: 'text', text: combinedText }, ...otherParts],
      }
    }
  } else {
    newPrompt.push({
      role: 'user',
      content: [{ type: 'text', text: instruction }],
    })
  }

  return newPrompt
}

// ============================================================================
// Middleware
// ============================================================================

export interface PromptSchemaMiddlewareOptions {
  instruction?: string
  typeName?: string
}

export function promptSchemaMiddleware(
  options: PromptSchemaMiddlewareOptions = {},
): LanguageModelV4Middleware {
  const instructionTemplate = options.instruction ?? SCHEMA_INSTRUCTION_TEMPLATE
  const typeName = options.typeName ?? 'Response'

  return {
    specificationVersion: 'v4',
    transformParams: async ({ params }) => {
      const { responseFormat } = params

      if (!responseFormat || responseFormat.type !== 'json') {
        return params
      }

      const instruction = responseFormat.schema
        ? instructionTemplate.replace(
            '{schema}',
            schemaToTypeScriptBlock(responseFormat.schema as JSONSchema7, typeName),
          )
        : SIMPLE_JSON_INSTRUCTION

      return {
        ...params,
        prompt: injectSchemaIntoPrompt(params.prompt, instruction),
        responseFormat: undefined,
      }
    },
  }
}
