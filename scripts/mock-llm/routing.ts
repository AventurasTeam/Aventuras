import { createHash } from 'node:crypto'

import { schemaToTypeScriptBlock, type JsonSchema } from '@/lib/ai'

import { STRUCTURED_SHAPES, type StructuredShape } from './shapes'

export const NARRATIVE_LANE = 'narrative'
export const TOOL_LANE_PREFIX = 'tools:'

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
  | {
      lane: 'tool'
      /** `toolLaneKey` of the request's tool names. */
      key: string
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

function callsAndReasoningText(message: unknown): string[] {
  const { tool_calls: calls, reasoning_content: reasoning } = message as {
    tool_calls?: unknown
    reasoning_content?: unknown
  }
  const callParts = Array.isArray(calls)
    ? calls.flatMap((call) => {
        const fn = (call as { function?: { name?: unknown; arguments?: unknown } } | null)?.function
        return [fn?.name, fn?.arguments].filter((part): part is string => typeof part === 'string')
      })
    : []
  return [...(typeof reasoning === 'string' ? [reasoning] : []), ...callParts]
}

/**
 * A tool request's prompt as a server counts it: `promptText`, the tool definitions, and each
 * message's calls and reasoning. Close to the app's estimate, not equal: the app counts the SDK's
 * shapes part by part, a tool result's name among them; this counts the wire's as one string.
 */
export function toolPromptText(body: Record<string, unknown>): string {
  return [
    promptText(body),
    JSON.stringify(body.tools ?? []),
    ...messagesOf(body).flatMap(callsAndReasoningText),
  ].join('\n')
}

/** The lane of a request carrying these tools: their names sorted, so the order sent is moot. */
export function toolLaneKey(names: readonly string[]): string {
  return `${TOOL_LANE_PREFIX}${[...names].sort().join('+')}`
}

/**
 * A non-streamed request carrying a `tools` array → its lane key; else null. An entry without a
 * string `function.name` is skipped, and a request with no valid name routes as one without tools.
 */
export function toolLaneOf(body: Record<string, unknown>): string | null {
  if (body.stream === true || !Array.isArray(body.tools) || body.tools.length === 0) return null
  const names = body.tools.flatMap((entry) => {
    const name = (entry as { function?: { name?: unknown } } | null)?.function?.name
    return typeof name === 'string' ? [name] : []
  })
  return names.length === 0 ? null : toolLaneKey(names)
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
 * Exact block match first, else a substring scan, longest block first so a superset schema wins:
 * none exists today (asserted in routing.test.ts), but the scan must not break the day one does.
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
 * Earliest marker wins, not registry order: the real one opens the user half (system halves hold
 * none; shapes.test.ts), a sibling's quoted in a refine's `current` preview sits deeper.
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
  const toolLane = toolLaneOf(body)
  if (toolLane !== null) return { lane: 'tool', key: toolLane }

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
