/**
 * SHA-256 hash truncated to 16 hex chars, used as cache key suffix for API keys.
 * Does NOT normalize input — `"sk-abc"` and `"sk-abc "` (trailing space) yield
 * different hashes by design, so trivial copy-paste mistakes don't collide
 * silently with the canonical key in the health cache.
 */
export async function hashApiKey(apiKey: string): Promise<string> {
  const data = new TextEncoder().encode(apiKey)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer, 0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
