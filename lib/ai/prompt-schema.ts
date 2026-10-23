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
  oneOf?: JsonSchemaNode[]
  items?: JsonSchemaNode
  properties?: Record<string, JsonSchemaNode>
  required?: string[]
  description?: string
}

function jsonSchemaToTypeScript(schema: JsonSchemaNode, indent = 0): string {
  const pad = '  '.repeat(indent)
  const padInner = '  '.repeat(indent + 1)

  // zod v4 emits literals as `const`, nullables as `anyOf [T, null]`, and
  // discriminated unions as `oneOf`; both keywords render as one TS union.
  if (schema.const !== undefined) return JSON.stringify(schema.const)
  const unionMembers = schema.anyOf ?? schema.oneOf
  if (unionMembers) {
    return unionMembers.map((member) => jsonSchemaToTypeScript(member, indent)).join(' | ')
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

// Placement and its rationale: architecture.md → Structured output.
const SCHEMA_CONTRACT_TEMPLATE = `Respond strictly with JSON. The JSON should be compatible with the TypeScript type Response from the following:

{schema}`
const SCHEMA_CLOSING = 'Output ONLY the JSON object, no other text or markdown.'

const SIMPLE_JSON_CONTRACT = 'Respond strictly with valid JSON.'
const SIMPLE_JSON_CLOSING = 'Output ONLY the JSON, no other text.'

function appendToLastSystem(prompt: ModelPrompt, contract: string): ModelPrompt {
  const lastSystemIdx = prompt.findLastIndex((msg) => msg.role === 'system')
  if (lastSystemIdx === -1) return [{ role: 'system', content: contract }, ...prompt]
  return prompt.map((msg, i) =>
    i === lastSystemIdx && msg.role === 'system'
      ? { ...msg, content: `${msg.content}\n\n${contract}` }
      : msg,
  )
}

function appendToLastUser(prompt: ModelPrompt, closing: string): ModelPrompt {
  const lastUserIdx = prompt.findLastIndex((msg) => msg.role === 'user')
  if (lastUserIdx === -1) {
    return [...prompt, { role: 'user', content: [{ type: 'text', text: closing }] }]
  }
  return prompt.map((msg, i) => {
    if (i !== lastUserIdx || msg.role !== 'user') return msg
    const textParts = msg.content.filter((p) => p.type === 'text')
    const otherParts = msg.content.filter((p) => p.type !== 'text')
    const text = textParts.map((p) => p.text).join('\n') + '\n\n' + closing
    return { ...msg, content: [{ type: 'text', text }, ...otherParts] }
  })
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
 * For providers without native structured output: swaps `responseFormat: json` for TS types ending
 * the system message (created if absent) and a closing line ending the last user message.
 */
export function promptSchemaMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => {
      const { responseFormat } = params

      if (!responseFormat || responseFormat.type !== 'json') {
        return params
      }

      const [contract, closing] = responseFormat.schema
        ? [
            SCHEMA_CONTRACT_TEMPLATE.replace(
              '{schema}',
              schemaToTypeScriptBlock(responseFormat.schema),
            ),
            SCHEMA_CLOSING,
          ]
        : [SIMPLE_JSON_CONTRACT, SIMPLE_JSON_CLOSING]

      return {
        ...params,
        prompt: appendToLastUser(appendToLastSystem(params.prompt, contract), closing),
        responseFormat: undefined,
      }
    },
  }
}
