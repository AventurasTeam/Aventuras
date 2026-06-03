// Crockford base32 — excludes I, L, O, U to avoid transcription ambiguity.
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ENCODING_LEN = ENCODING.length
const TIME_LEN = 10
const RANDOM_LEN = 16

function encodeTime(now: number): string {
  let out = ''
  let remaining = now
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    const mod = remaining % ENCODING_LEN
    out = ENCODING[mod] + out
    remaining = (remaining - mod) / ENCODING_LEN
  }
  return out
}

function encodeRandom(): string {
  let out = ''
  for (let i = 0; i < RANDOM_LEN; i++) {
    out += ENCODING[Math.floor(Math.random() * ENCODING_LEN)]
  }
  return out
}

// Generation-only ULID for log/HTTP-call ids. Not monotonic: FIFO ordering
// comes from array insertion order, not from the id.
export function ulid(): string {
  return encodeTime(Date.now()) + encodeRandom()
}
