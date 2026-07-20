import type { LanguageModelMiddleware } from 'ai'

// Derived from the middleware contract instead of importing
// '@ai-sdk/provider' directly — the provider package is a transitive dep.
type CallOptions = Awaited<ReturnType<NonNullable<LanguageModelMiddleware['transformParams']>>>
type ModelPrompt = CallOptions['prompt']
type JsonResponseFormat = Extract<NonNullable<CallOptions['responseFormat']>, { type: 'json' }>
export type JsonSchema = NonNullable<JsonResponseFormat['schema']>

type JsonSchemaNode = {
  type?: string | string[]
  enum?: unknown[]
  const?: unknown
  anyOf?: JsonSchemaNode[]
  items?: JsonSchemaNode
  properties?: Record<string, JsonSchemaNode>
  required?: string[]
  description?: string
}

function jsonSchemaToTypeScript(schema: JsonSchemaNode, indent = 0): string {
  const pad = '  '.repeat(indent)
  const padInner = '  '.repeat(indent + 1)

  // zod v4 emits literals as `const` and nullables as `anyOf [T, null]`.
  if (schema.const !== undefined) return JSON.stringify(schema.const)
  if (schema.anyOf) {
    return schema.anyOf.map((member) => jsonSchemaToTypeScript(member, indent)).join(' | ')
  }

  const nullable = Array.isArray(schema.type) && schema.type.includes('null')
  const primaryType = Array.isArray(schema.type)
    ? schema.type.find((t) => t !== 'null')
    : schema.type

  function withNullable(type: string): string {
    return nullable ? `${type} | null` : type
  }

  switch (primaryType) {
    case 'string':
      if (schema.enum) {
        const enumValues = schema.enum.map((v) => JSON.stringify(v)).join(' | ')
        return nullable ? `(${enumValues}) | null` : enumValues
      }
      return withNullable('string')

    case 'number':
    case 'integer':
      return withNullable('number')

    case 'boolean':
      return withNullable('boolean')

    case 'null':
      return 'null'

    case 'array': {
      const itemType = schema.items ? jsonSchemaToTypeScript(schema.items, indent) : 'unknown'
      // Parenthesize a union item type so `[]` binds to the whole union:
      // `(string | null)[]`, not the ambiguous `string | null[]`.
      const wrapped = itemType.includes(' | ') ? `(${itemType})` : itemType
      return withNullable(`${wrapped}[]`)
    }

    case 'object': {
      if (!schema.properties || Object.keys(schema.properties).length === 0) {
        return withNullable('Record<string, unknown>')
      }

      const required = new Set(schema.required ?? [])
      const props = Object.entries(schema.properties)
        .map(([key, propSchema]) => {
          const optional = required.has(key) ? '' : '?'
          const propType = jsonSchemaToTypeScript(propSchema, indent + 1)
          const description = propSchema.description ? ` // ${propSchema.description}` : ''
          return `${padInner}${key}${optional}: ${propType};${description}`
        })
        .join('\n')

      return withNullable(`{\n${props}\n${pad}}`)
    }

    default:
      return 'unknown'
  }
}

export function schemaToTypeScriptBlock(schema: JsonSchema, name = 'Response'): string {
  const node = schema as JsonSchemaNode
  const typeBody = jsonSchemaToTypeScript(node, 0)
  if (node.type === 'object' && node.properties) {
    return `interface ${name} ${typeBody}`
  }
  return `type ${name} = ${typeBody}`
}

const SCHEMA_INSTRUCTION_TEMPLATE = `Respond strictly with JSON. The JSON should be compatible with the TypeScript type Response from the following:

{schema}

Output ONLY the JSON object, no other text or markdown.`

const SIMPLE_JSON_INSTRUCTION =
  'Respond strictly with valid JSON. Output ONLY the JSON, no other text.'

function injectSchemaIntoPrompt(prompt: ModelPrompt, instruction: string): ModelPrompt {
  const newPrompt = [...prompt]
  const lastUserIdx = newPrompt.findLastIndex((msg) => msg.role === 'user')

  if (lastUserIdx >= 0) {
    const lastUserMsg = newPrompt[lastUserIdx]
    if (lastUserMsg && lastUserMsg.role === 'user') {
      const textParts = lastUserMsg.content.filter((p) => p.type === 'text')
      const otherParts = lastUserMsg.content.filter((p) => p.type !== 'text')
      const combinedText = textParts.map((p) => p.text).join('\n') + '\n\n' + instruction

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

/** Declares the JSON output contract on the call so a provider with native structured output (or the prompt-injection middleware below) can act on it. */
export function jsonResponseFormatMiddleware(schema: JsonSchema): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => ({
      ...params,
      responseFormat: { type: 'json', schema },
    }),
  }
}

/**
 * For providers/models without native structured output: converts a declared
 * `responseFormat: json` into the schema rendered as TypeScript types inside
 * the prompt, and strips the responseFormat from the request.
 */
export function promptSchemaMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => {
      const { responseFormat } = params

      if (!responseFormat || responseFormat.type !== 'json') {
        return params
      }

      const instruction = responseFormat.schema
        ? SCHEMA_INSTRUCTION_TEMPLATE.replace(
            '{schema}',
            schemaToTypeScriptBlock(responseFormat.schema),
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
