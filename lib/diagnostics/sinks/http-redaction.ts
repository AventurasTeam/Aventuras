import { logger } from '../core/logger'

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

// Fragments (e.g. #access_token=…) aren't parsed: providers here are header/API-key
// auth, and a long fragment secret still falls to the substring pass below.
export function redactUrl(url: string): string {
  const base = 'http://aventuras.local'
  const parsed = new URL(url, base)
  let changed = false

  if (knownSecrets.has(parsed.username)) {
    parsed.username = REDACTED
    changed = true
  }
  if (knownSecrets.has(parsed.password)) {
    parsed.password = REDACTED
    changed = true
  }

  const redactedEntries = Array.from(parsed.searchParams.entries()).map(([key, value]) =>
    knownSecrets.has(value) ? [key, REDACTED] : [key, value],
  )
  if (redactedEntries.some(([, value]) => value === REDACTED)) {
    changed = true
    parsed.search = ''
    for (const [key, value] of redactedEntries) {
      parsed.searchParams.append(key, value)
    }
  }

  if (!changed) return url

  return /^https?:\/\//i.test(url)
    ? parsed.toString()
    : `${parsed.pathname}${parsed.search}${parsed.hash}`
}

const EMBEDDED_URL_PATTERN = /https?:\/\/[^\s)"'>]+/gi
// Trailing punctuation or a V8 ":line:col" frame suffix that the URL match would
// otherwise absorb into the query value, breaking redactUrl's exact-match check.
const TRAILING_NOISE = /(:\d+:\d+|[,.;:\]}])+$/
// TRAILING_NOISE is $- but not ^-anchored, so .match retries from every offset —
// quadratic on a long hostile run. Bound the slice rather than prove the regex
// safe; real trailing noise never nears 32.
const MAX_TRAILING_NOISE_SCAN = 32

// URL-shaped spans only, redacted through redactUrl's exact-match check — a blind
// substring scan would false-positive on short keys (see this file's test).
export function redactUrlsInText(text: string): string {
  return text.replace(EMBEDDED_URL_PATTERN, (match) => {
    const tail = match.slice(-MAX_TRAILING_NOISE_SCAN)
    const noise = tail.match(TRAILING_NOISE)?.[0] ?? ''
    const url = noise ? match.slice(0, -noise.length) : match
    try {
      return redactUrl(url) + noise
    } catch {
      // Fails OPEN on a security control, so it must not fail silently: a key
      // shorter than MIN_SUBSTRING_SECRET_LENGTH in an unparseable span reaches the log.
      logger.warn('provider.url_redaction_failed', { length: match.length })
      return match
    }
  })
}

// Floor of 6: local openai-compatible servers use short conventional keys ('ollama'
// is the shortest documented); higher leaks those, lower false-positives ordinary
// text. Keys under 6 stay unprotected — see docs/observability.md, Privacy.
const MIN_SUBSTRING_SECRET_LENGTH = 6

export function redactKnownSecretSubstrings(text: string): string {
  let result = text
  // Longest first: a shorter key that's a prefix of a longer one would
  // otherwise redact only its own span and leave the longer key's tail.
  const secrets = Array.from(knownSecrets)
    .filter((secret) => secret.length >= MIN_SUBSTRING_SECRET_LENGTH)
    .sort((a, b) => b.length - a.length)
  for (const secret of secrets) {
    result = result.split(secret).join(REDACTED)
  }
  return result
}

export function redactSecretsInText(text: string): string {
  return redactKnownSecretSubstrings(redactUrlsInText(text))
}
