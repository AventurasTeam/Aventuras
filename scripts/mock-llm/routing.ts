import { createHash } from 'node:crypto'

import { schemaToTypeScriptBlock, type JsonSchema } from '@/lib/ai'

import { STRUCTURED_SHAPES, type StructuredShape } from './shapes'

export const NARRATIVE_LANE = 'narrative'

// The bracketing text of SCHEMA_INSTRUCTION_TEMPLATE (lib/ai/prompt-schema.ts).
// Not exported by the app, so routing.test.ts drives the real
// promptSchemaMiddleware and asserts the extractor still recovers the block —
// a template edit fails that test rather than silently degrading every match.
const BLOCK_OPEN = 'from the following:\n\n'
const BLOCK_CLOSE = '\n\nOutput ONLY the JSON object'

export type Route =
  | { lane: typeof NARRATIVE_LANE }
  | {
      lane: 'structured'
      /** Stable lane key: the registry name, or `unknown:<hash>`. */
      key: string
      shape: StructuredShape | null
      /** The TypeScript block this request declared, when one could be recovered. */
      block: string | null
    }

export function promptText(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? body.messages : []
  return messages
    .map((m) => {
      const content = (m as { content?: unknown }).content
      if (typeof content === 'string') return content
      if (Array.isArray(content))
        return content.map((p) => (p as { text?: string }).text ?? '').join('\n')
      return ''
    })
    .join('\n')
}

/** The TS block the prompt-injection path writes into the last user message. */
export function extractBlockFromPrompt(text: string): string | null {
  const open = text.indexOf(BLOCK_OPEN)
  if (open === -1) return null
  const start = open + BLOCK_OPEN.length
  const close = text.indexOf(BLOCK_CLOSE, start)
  if (close === -1) return null
  return text.slice(start, close)
}

// The 'force-on' path keeps responseFormat instead of injecting the block, so
// the wire carries a JSON Schema. Rendering it through the app's own renderer
// puts both paths on one comparable key.
function blockFromResponseFormat(body: Record<string, unknown>): string | null {
  const format = body.response_format as
    | { type?: string; json_schema?: { schema?: unknown } }
    | undefined
  const schema = format?.json_schema?.schema
  if (schema === undefined || schema === null || typeof schema !== 'object') return null
  try {
    return schemaToTypeScriptBlock(schema as JsonSchema)
  } catch {
    return null
  }
}

/**
 * Exact block equality first; the substring scan is the fallback for a prompt
 * the extractor could not bracket. That scan takes the longest block first, so
 * a schema that is a superset of another still wins — today no registered block
 * contains another (asserted in routing.test.ts), but the scan must not be the
 * thing that breaks on the day one does.
 *
 * `shapes` is a parameter so the ordering rule can be tested with a pair that
 * actually nests; production always passes the registry.
 */
export function matchShape(
  block: string | null,
  text: string,
  shapes: readonly StructuredShape[] = STRUCTURED_SHAPES,
): StructuredShape | null {
  if (block !== null) {
    const exact = shapes.find((s) => s.block === block)
    if (exact) return exact
  }
  const byLength = [...shapes].sort((a, b) => b.block.length - a.block.length)
  return byLength.find((s) => text.includes(s.block)) ?? null
}

export function unknownKey(block: string | null): string {
  if (block === null) return 'unknown:no-schema'
  return `unknown:${createHash('sha1').update(block).digest('hex').slice(0, 8)}`
}

export function classifyRequest(body: Record<string, unknown>): Route {
  if (body.stream === true) return { lane: NARRATIVE_LANE }

  const text = promptText(body)
  const block = extractBlockFromPrompt(text) ?? blockFromResponseFormat(body)
  const shape = matchShape(block, text)

  return {
    lane: 'structured',
    key: shape?.name ?? unknownKey(block),
    shape,
    block: block ?? shape?.block ?? null,
  }
}

export function laneKeyOf(route: Route): string {
  return route.lane === NARRATIVE_LANE ? NARRATIVE_LANE : route.key
}
