import type { DebugLogEntry } from '#lib/stores/debugLog.ts'
import { errMessage } from '#lib/utils/error.ts'

export const MAX_DISPLAY_CHARS = 200_000

/** JSON.stringify that survives circular references instead of throwing. */
export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? ''
  } catch {
    const seen = new Set<object>()
    return (
      JSON.stringify(
        value,
        (_key, v) => {
          if (typeof v === 'object' && v !== null) {
            if (seen.has(v)) return '[Circular]'
            seen.add(v)
          }
          return v
        },
        2,
      ) ?? ''
    )
  }
}

interface WalkState {
  readable: boolean
  jsonText: boolean
  /** Estimated characters of output so far, indentation and punctuation included. */
  used: number
  /** The containers being walked, to cut a cycle. */
  ancestors: object[]
}

/** A string holding a JSON object or array, parsed; undefined for any other string. */
function parseJsonText(text: string): object | undefined {
  const trimmed = text.trim()
  const first = trimmed[0]
  const last = trimmed.at(-1)
  if (!((first === '{' && last === '}') || (first === '[' && last === ']'))) return undefined
  try {
    return JSON.parse(trimmed) as object
  } catch {
    return undefined
  }
}

function cutString(text: string, room: number): string {
  let keep = Math.max(0, room)
  // Escapes take more than one character in the output.
  const extra = JSON.stringify(text.slice(0, keep)).length - 2 - keep
  keep = Math.max(0, keep - extra)
  return `${text.slice(0, keep)}… [${(text.length - keep).toLocaleString()} more chars]`
}

function walkString(text: string, state: WalkState, depth: number): unknown {
  const parsed = parseJsonText(text)
  if (parsed) {
    state.jsonText = true
    if (state.readable) return walk(parsed, state, depth)
  }
  const room = MAX_DISPLAY_CHARS - state.used
  if (text.length > room) {
    const cut = cutString(text, room)
    state.used += cut.length
    return cut
  }
  state.used += text.length + 2
  return text
}

/**
 * Copies `value` for display: JSON text expanded when readable, cycles cut, and anything past the
 * display limit replaced by markers, so the result always stringifies to valid JSON.
 */
function walk(value: unknown, state: WalkState, depth: number): unknown {
  if (typeof value === 'string') return walkString(value, state, depth)
  if (typeof value === 'bigint') return `${value}n`
  if (typeof value !== 'object' || value === null) {
    state.used += 5
    return value
  }
  if ('toJSON' in value && typeof value.toJSON === 'function') return value
  if (state.ancestors.includes(value)) return '[Circular]'

  state.ancestors.push(value)
  const indent = 2 * (depth + 1)
  let result: unknown
  if (Array.isArray(value)) {
    const items: unknown[] = []
    for (const [index, item] of value.entries()) {
      if (state.used >= MAX_DISPLAY_CHARS) {
        items.push(`… ${(value.length - index).toLocaleString()} more items`)
        break
      }
      state.used += indent + 2
      items.push(walk(item, state, depth + 1))
    }
    result = items
  } else {
    const entries = Object.entries(value)
    const fields: [string, unknown][] = []
    for (const [index, [key, item]] of entries.entries()) {
      if (state.used >= MAX_DISPLAY_CHARS) {
        fields.push(['…', `${(entries.length - index).toLocaleString()} more keys`])
        break
      }
      state.used += indent + key.length + 6
      fields.push([key, walk(item, state, depth + 1)])
    }
    // Not assignment: a `__proto__` key would set the prototype instead of a field.
    result = Object.fromEntries(fields)
  }
  state.ancestors.pop()
  return result
}

export interface FormattedJson {
  text: string
  /** A string value held a JSON object or array, whether or not it was expanded. */
  jsonText: boolean
}

/**
 * With `readable`, JSON text is expanded into the value it holds and escaped newlines become line
 * breaks, so the text is for reading, not parsing. Otherwise it is valid JSON, truncated.
 * Throws if the data cannot be serialized.
 */
export function formatEntryJson(entry: DebugLogEntry, readable: boolean): FormattedJson {
  const state: WalkState = { readable, jsonText: false, used: 0, ancestors: [] }
  const walked = walk(entry.data, state, 0)
  let text = JSON.stringify(walked, null, 2) ?? '(no data)'
  if (readable) text = text.replace(/\\n/g, '\n')
  return { text, jsonText: state.jsonText }
}

/**
 * Formatted JSON per entry object. Keyed on identity, so a replaced entry misses and an
 * evicted one is collected together with its text.
 */
export class DebugJsonCache {
  private readonly cache = new WeakMap<DebugLogEntry, FormattedJson & { readable: boolean }>()

  get(entry: DebugLogEntry, readable: boolean): FormattedJson {
    const hit = this.cache.get(entry)
    if (hit && hit.readable === readable) return hit

    try {
      const formatted = { ...formatEntryJson(entry, readable), readable }
      this.cache.set(entry, formatted)
      return formatted
    } catch (err) {
      console.error('[DebugLogView] formatEntryJson failed for entry', entry.id, err)
      // Not cached, so the next render retries.
      return { text: `[Serialization error: ${errMessage(err)}]`, jsonText: false }
    }
  }
}
