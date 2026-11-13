import type { DebugLogEntry } from '#lib/stores/debugLog.ts'
import { errMessage } from '#lib/utils/error.ts'

export const MAX_DISPLAY_CHARS = 200_000

function stringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    // Likely circular references — retry with a replacer that cuts them.
    const seen = new Set<object>()
    return JSON.stringify(
      value,
      (_key, v) => {
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) return '[Circular]'
          seen.add(v)
        }
        return v
      },
      2,
    )
  }
}

/** JSON.stringify that survives circular references instead of throwing. */
export function safeStringify(value: unknown): string {
  return stringify(value) ?? ''
}

/** Throws if the data cannot be serialized even with the circular-reference fallback. */
export function formatEntryJson(entry: DebugLogEntry, renderNewlines: boolean): string {
  let json = stringify(entry.data) ?? '(no data)'
  if (renderNewlines) {
    json = json.replace(/\\n/g, '\n')
  }
  if (json.length > MAX_DISPLAY_CHARS) {
    json =
      json.slice(0, MAX_DISPLAY_CHARS) +
      `\n\n... [truncated — ${json.length.toLocaleString()} total chars] ...`
  }
  return json
}

/**
 * Formatted JSON per entry object. Keyed on identity, so a replaced entry misses and an
 * evicted one is collected together with its text.
 */
export class DebugJsonCache {
  private readonly cache = new WeakMap<DebugLogEntry, { renderNewlines: boolean; text: string }>()

  get(entry: DebugLogEntry, renderNewlines: boolean): string {
    const hit = this.cache.get(entry)
    if (hit && hit.renderNewlines === renderNewlines) return hit.text

    try {
      const text = formatEntryJson(entry, renderNewlines)
      this.cache.set(entry, { renderNewlines, text })
      return text
    } catch (err) {
      console.error('[DebugLogView] formatEntryJson failed for entry', entry.id, err)
      // Not cached, so the next render retries.
      return `[Serialization error: ${errMessage(err)}]`
    }
  }
}
