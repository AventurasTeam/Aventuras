// Helpers for the GET requests that list a provider's models.

/** The `Authorization` header for a key, or none when there is no key. */
export const bearerHeaders = (key: string): { Authorization: string } | undefined =>
  key ? { Authorization: `Bearer ${key}` } : undefined
