import { z } from 'zod'

// Field descriptions live on the schema (.describe) and render into the
// wizard prompts via renderOutputFields, so the validated shape and the
// prompt's field list cannot drift apart.
export const openingOutputSchema = z.object({
  prose: z.string().describe('the opening passage as a string'),
  sceneEntities: z
    .array(z.string())
    .describe(
      'cast ids present in the scene (use the exact cast id(s) provided above; [] if none)',
    ),
  currentLocationId: z
    .string()
    .nullable()
    .describe('the location id where the scene opens, or null'),
  worldTime: z.literal(0),
})
export const titleChipsSchema = z.object({
  titles: z.array(z.string()).min(1).describe('five short, evocative titles'),
})
export const descriptionOutputSchema = z.object({
  description: z.string().describe('the one-sentence log line'),
})

export type OpeningOutput = z.infer<typeof openingOutputSchema>

type JsonSchemaNode = {
  type?: string | string[]
  items?: JsonSchemaNode
  anyOf?: JsonSchemaNode[]
  const?: unknown
  description?: string
}

function typeLabel(node: JsonSchemaNode): string {
  if (node.const !== undefined) return `always ${JSON.stringify(node.const)}`
  if (node.anyOf) return node.anyOf.map(typeLabel).join(' or ')
  if (Array.isArray(node.type)) return node.type.join(' or ')
  if (node.type === 'array') return `array of ${node.items ? typeLabel(node.items) : 'items'}`
  return node.type ?? 'value'
}

/** Prompt-ready field list (`- "name" (type): description`) derived from the schema. */
export function renderOutputFields(schema: z.ZodObject<z.ZodRawShape>): string {
  const json = z.toJSONSchema(schema) as JsonSchemaNode & {
    properties?: Record<string, JsonSchemaNode>
  }
  return Object.entries(json.properties ?? {})
    .map(([name, prop]) => {
      const head = `- "${name}" (${typeLabel(prop)})`
      return prop.description != null ? `${head}: ${prop.description}.` : `${head}.`
    })
    .join('\n')
}
