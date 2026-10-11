// Blocked IPv4 ranges: unspecified, private, shared, loopback, link-local, multicast, reserved.
const BLOCKED_IPV4: readonly (readonly [number, number])[] = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0a80000, 16],
  [0xe0000000, 4],
  [0xf0000000, 4],
]

const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa']

function isBlockedIPv4(ip: number): boolean {
  return BLOCKED_IPV4.some(([base, bits]) => {
    const mask = (~0 << (32 - bits)) >>> 0
    return (ip & mask) >>> 0 === base
  })
}

function parseIPv4(host: string): number | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!match) return null
  const octets = match.slice(1).map(Number)
  if (octets.some((octet) => octet > 255)) return null
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0
}

/** Expands a canonical IPv6 literal (no brackets) to its eight 16-bit groups. */
function parseIPv6(host: string): number[] | null {
  const [head, tail, ...extra] = host.split('::')
  if (extra.length > 0) return null
  const front = head ? head.split(':') : []
  const back = tail ? tail.split(':') : []
  const fill = tail === undefined ? 0 : 8 - front.length - back.length
  if (fill < 0 || (tail === undefined && front.length !== 8)) return null
  const groups = [...front, ...Array<string>(fill).fill('0'), ...back].map((g) =>
    /^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN,
  )
  return groups.length === 8 && groups.every((g) => !Number.isNaN(g)) ? groups : null
}

function isPublicIPv6(host: string): boolean {
  const groups = parseIPv6(host)
  if (!groups) return false
  // `::`, `::1`, `::a.b.c.d` and `::ffff:a.b.c.d` carry an IPv4 address in the last 32 bits.
  if (groups.slice(0, 5).every((g) => g === 0) && (groups[5] === 0 || groups[5] === 0xffff)) {
    return !isBlockedIPv4(((groups[6] << 16) | groups[7]) >>> 0)
  }
  const first = groups[0]
  return (first & 0xfe00) !== 0xfc00 && (first & 0xffc0) !== 0xfe80 && (first & 0xff00) !== 0xff00
}

/**
 * Whether an `http(s)` URL points at a host outside the user's own machine and network.
 * Judges the name and IP literals only: a public name that resolves to a private address passes.
 */
export function isPublicHttpUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false

  // The parser has already normalised numeric IPv4 forms (`2130706433`, `0x7f.1`) to dotted quads.
  const host = parsed.hostname.replace(/\.$/, '')
  if (host.startsWith('[')) return isPublicIPv6(host.slice(1, -1))

  const ip = parseIPv4(host)
  if (ip !== null) return !isBlockedIPv4(ip)

  // A single label resolves through the machine's search domains, i.e. to something local.
  if (!host.includes('.')) return false
  return !LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))
}
