// xxh32 inline (deterministic across runtimes, no maintained pure-JS dep)

const PRIME1 = 2654435761
const PRIME2 = 2246822519
const PRIME3 = 3266489917
const PRIME4 = 668265263
const PRIME5 = 374761393

function rotl(x: number, r: number): number {
  return ((x << r) | (x >>> (32 - r))) >>> 0
}

function readLE32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  )
}

export function sourceHash(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const len = bytes.length
  const seed = 0

  let h32: number
  let offset = 0

  if (len >= 16) {
    let v1 = (seed + PRIME1 + PRIME2) >>> 0
    let v2 = (seed + PRIME2) >>> 0
    let v3 = seed >>> 0
    let v4 = (seed - PRIME1) >>> 0

    const limit = len - 16
    do {
      v1 = Math.imul(rotl((v1 + Math.imul(readLE32(bytes, offset), PRIME2)) >>> 0, 13), PRIME1)
      v1 = v1 >>> 0
      offset += 4
      v2 = Math.imul(rotl((v2 + Math.imul(readLE32(bytes, offset), PRIME2)) >>> 0, 13), PRIME1)
      v2 = v2 >>> 0
      offset += 4
      v3 = Math.imul(rotl((v3 + Math.imul(readLE32(bytes, offset), PRIME2)) >>> 0, 13), PRIME1)
      v3 = v3 >>> 0
      offset += 4
      v4 = Math.imul(rotl((v4 + Math.imul(readLE32(bytes, offset), PRIME2)) >>> 0, 13), PRIME1)
      v4 = v4 >>> 0
      offset += 4
    } while (offset <= limit)

    h32 = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) >>> 0
  } else {
    h32 = (seed + PRIME5) >>> 0
  }

  h32 = (h32 + len) >>> 0

  // Process tail (4-byte words, then 1-byte)
  while (offset + 4 <= len) {
    h32 = Math.imul(rotl((h32 + Math.imul(readLE32(bytes, offset), PRIME3)) >>> 0, 17), PRIME4)
    h32 = h32 >>> 0
    offset += 4
  }

  while (offset < len) {
    h32 = Math.imul(rotl((h32 + Math.imul(bytes[offset], PRIME5)) >>> 0, 11), PRIME1)
    h32 = h32 >>> 0
    offset += 1
  }

  // Final avalanche. The trailing `>>> 0` is load-bearing: `^` yields a signed
  // int32, so without it every hash with the high bit set formats as a negative
  // 9-char string ('-77e5d848') instead of its unsigned hex.
  h32 = h32 ^ (h32 >>> 15)
  h32 = Math.imul(h32, PRIME2) >>> 0
  h32 = h32 ^ (h32 >>> 13)
  h32 = Math.imul(h32, PRIME3) >>> 0
  h32 = (h32 ^ (h32 >>> 16)) >>> 0

  return h32.toString(16).padStart(8, '0')
}

export function compositeText(fields: (string | null | undefined)[]): string {
  return fields.map((f) => f ?? '').join(' ')
}
