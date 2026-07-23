import { ID_PATTERN, type SubstitutablePrefix } from '@/lib/ids'

// Deterministic, dependency-free UUID derivation. buildSeedSteps runs under
// both the Node seed script and Hermes (native reseed), so no node:crypto — a
// small mixing hash is enough: a fixture id only needs stable, well-distributed
// hex, not cryptographic strength. Shaped as a v4 UUID so it reads as normal.
function seedUuid(seed: string): string {
  let h1 = 0x9e3779b1 ^ seed.length
  let h2 = 0x85ebca77
  let h3 = 0xc2b2ae3d
  let h4 = 0x27d4eb2f
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
    h3 = Math.imul(h3 ^ c, 2246822519)
    h4 = Math.imul(h4 ^ c, 3266489917)
    h1 ^= h1 >>> 15
    h2 ^= h2 >>> 13
    h3 ^= h3 >>> 16
    h4 ^= h4 >>> 11
  }
  const hex8 = (n: number) => (n >>> 0).toString(16).padStart(8, '0')
  const raw = (hex8(h1) + hex8(h2) + hex8(h3) + hex8(h4)).split('')
  raw[12] = '4'
  raw[16] = ((parseInt(raw[16], 16) & 0x3) | 0x8).toString(16)
  const s = raw.join('')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`
}

// Authored seed prefix → canonical kind prefix. The dataset authored two kinds
// off-spec (fac→fact, thread→thr); everything else maps to itself. See
// docs/data-model.md → ID shape.
const CANONICAL_PREFIX: Partial<Record<string, SubstitutablePrefix>> = {
  char: 'char',
  loc: 'loc',
  item: 'item',
  fac: 'fact',
  fact: 'fact',
  lore: 'lore',
  thr: 'thr',
  thread: 'thr',
  hap: 'hap',
  chap: 'chap',
}

const MNEMONIC = /^([a-z]+)_([a-z][a-z0-9_]*)$/

// A seeded mnemonic id (char_kael, fac_watch, thread_trust) → its canonical
// prefix_<uuid> form. Anything else — prose, non-substitutable ids, ids already
// in prefix_<uuid> form — returns null and is left untouched.
export function canonicalSeedId(value: string): string | null {
  if (ID_PATTERN.test(value)) return null
  const match = MNEMONIC.exec(value)
  if (!match) return null
  const canonical = CANONICAL_PREFIX[match[1]]
  if (!canonical) return null
  // Seed from the canonical form so correcting an off-spec authored prefix in
  // the dataset later leaves the generated uuid unchanged.
  return `${canonical}_${seedUuid(`${canonical}_${match[2]}`)}`
}

// Deep-walk a seed row, rewriting mnemonic ids wherever they appear — top-level
// columns, nested state/metadata JSON, and id arrays alike. Mirrors the reach
// of substituteIds so no reference is missed.
export function remapSeedIds<T>(value: T): T {
  if (typeof value === 'string') return (canonicalSeedId(value) ?? value) as T
  if (Array.isArray(value)) return value.map((v) => remapSeedIds(v)) as T
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remapSeedIds(v)])) as T
  return value
}
