/**
 * Advanced Settings' manual request body: raw JSON the user merges into the outgoing request.
 *
 * The rest of this module used to build request bodies itself -- an `extra_body` with
 * OpenRouter's `reasoning: { enabled: false }` shape among them. That path lost its last
 * caller when generation moved to the Vercel AI SDK, where provider options are built in
 * `sdk/generate.ts` instead. It survived long enough to suggest a second, contradictory way
 * of switching reasoning off.
 *
 * Keys the transport owns are rejected at the merge site (`providers/fetch.ts`), not here.
 */

/** `null` for absent, unparseable, or non-object input -- the caller then sends nothing extra. */
export function parseManualBody(body?: string | null): Record<string, unknown> | null {
  if (!body || !body.trim()) return null
  try {
    const parsed = JSON.parse(body)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}
