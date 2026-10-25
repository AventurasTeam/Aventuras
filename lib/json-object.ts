/** A parsed JSON object: not null, not an array. Doesn't check the prototype, so a class instance passes. */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
