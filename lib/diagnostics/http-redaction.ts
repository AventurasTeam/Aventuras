const REDACTED = '***'
const AUTH_PREFIXES = ['bearer ', 'basic ', 'token ']

let knownSecrets = new Set<string>()

export function setHttpCallKnownSecretValues(values: Iterable<string>): void {
  knownSecrets = new Set(Array.from(values).filter((value) => value.length > 0))
}

export function redactHeaderValue(value: string): string {
  if (knownSecrets.has(value)) return REDACTED

  const lowerValue = value.toLowerCase()
  for (const prefix of AUTH_PREFIXES) {
    if (!lowerValue.startsWith(prefix)) continue
    const stripped = value.slice(prefix.length)
    if (knownSecrets.has(stripped)) return REDACTED
  }

  return value
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, redactHeaderValue(value)]),
  )
}

export function redactResponseHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      key.toLowerCase() === 'set-cookie' ? value : redactHeaderValue(value),
    ]),
  )
}

export function redactUrl(url: string): string {
  const base = 'http://aventuras.local'
  const parsed = new URL(url, base)
  const entries = Array.from(parsed.searchParams.entries())
  const redactedEntries = entries.map(([key, value]) =>
    knownSecrets.has(value) ? [key, REDACTED] : [key, value],
  )
  const changed = redactedEntries.some(([, value]) => value === REDACTED)

  if (!changed) return url

  parsed.search = ''
  for (const [key, value] of redactedEntries) {
    parsed.searchParams.append(key, value)
  }

  return url.startsWith('http://') || url.startsWith('https://')
    ? parsed.toString()
    : `${parsed.pathname}${parsed.search}${parsed.hash}`
}
