import { createHash } from 'node:crypto'

import { schemaToTypeScriptBlock, type JsonSchema } from '@/lib/ai'

import { STRUCTURED_SHAPES, type StructuredShape } from './shapes'

export const NARRATIVE_LANE = 'narrative'

// Opener of SCHEMA_CONTRACT_TEMPLATE (lib/ai/prompt-schema.ts), appended last so the block runs
// to its end. Unexported: routing.test.ts drives the real middleware, so an edit fails there.
const BLOCK_OPEN = 'from the following:\n\n'
// What schemaToTypeScriptBlock emits first; story text quoting the opener doesn't.
const BLOCK_START = /^(interface Response |type Response = )/

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

function messagesOf(body: Record<string, unknown>): unknown[] {
  return Array.isArray(body.messages) ? body.messages : []
}

function contentText(message: unknown): string {
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (Array.isArray(content))
    return content.map((p) => (p as { text?: string }).text ?? '').join('\n')
  return ''
}

export function promptText(body: Record<string, unknown>): string {
  return messagesOf(body).map(contentText).join('\n')
}

/** The text of the request's system messages, where the contract's block sits. */
export function systemText(body: Record<string, unknown>): string {
  return messagesOf(body)
    .filter((m) => (m as { role?: unknown }).role === 'system')
    .map(contentText)
    .join('\n')
}

/**
 * The TS block the prompt-injection path writes at the end of the system message.
 * The last opener, not the first: the system half before the contract is story
 * text, which may quote the opener.
 */
export function extractBlockFromPrompt(text: string): string | null {
  const open = text.lastIndexOf(BLOCK_OPEN)
  if (open === -1) return null
  const block = text.slice(open + BLOCK_OPEN.length)
  return BLOCK_START.test(block) ? block : null
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
 */
function candidatesFor(
  block: string | null,
  text: string,
  shapes: readonly StructuredShape[],
): readonly StructuredShape[] {
  if (block !== null) {
    const exact = shapes.filter((s) => s.block === block)
    if (exact.length > 0) return exact
  }
  const byLength = [...shapes].sort((a, b) => b.block.length - a.block.length)
  const hit = byLength.find((s) => text.includes(s.block))
  return hit === undefined ? [] : shapes.filter((s) => s.block === hit.block)
}

/**
 * Earliest occurrence wins, not registry order: the real marker opens the user half (only the
 * system half and the contract precede it; no contract carries one, asserted in routing.test.ts),
 * while a sibling's, quoted in a refine's `current` preview, sits deeper and must not outrank it.
 */
function pickByMarker(
  candidates: readonly StructuredShape[],
  text: string,
): StructuredShape | null {
  let best: StructuredShape | null = null
  let bestAt = Infinity
  for (const shape of candidates) {
    if (shape.marker === '') continue
    const at = text.indexOf(shape.marker)
    if (at === -1 || at >= bestAt) continue
    best = shape
    bestAt = at
  }
  return best
}

/**
 * The shape this request answers with, or null when nothing claims it.
 *
 * A block identifies a SCHEMA, and several call sites can share one (the
 * wizard's generate/refine pairs, and genre/tone, all answer the same shapes).
 * Where the block is ambiguous the marker breaks the tie; where it is not, the
 * marker is not consulted at all, so a user-authored pack that rewrites a
 * wizard template only costs the calls that genuinely cannot be told apart
 * without it.
 *
 * `shapes` is a parameter so the ordering rules can be tested with pairs that
 * actually collide; production always passes the registry.
 */
export function matchShape(
  block: string | null,
  text: string,
  shapes: readonly StructuredShape[] = STRUCTURED_SHAPES,
): StructuredShape | null {
  const candidates = candidatesFor(block, text, shapes)
  if (candidates.length <= 1) return candidates[0] ?? null
  return pickByMarker(candidates, text)
}

export function unknownKey(block: string | null): string {
  if (block === null) return 'unknown:no-schema'
  return `unknown:${createHash('sha1').update(block).digest('hex').slice(0, 8)}`
}

export function classifyRequest(body: Record<string, unknown>): Route {
  if (body.stream === true) return { lane: NARRATIVE_LANE }

  const text = promptText(body)
  const block = extractBlockFromPrompt(systemText(body)) ?? blockFromResponseFormat(body)
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
