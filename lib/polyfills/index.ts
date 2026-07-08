// Hermes exposes no global `crypto`, so `crypto.randomUUID()` (the id seam in
// lib/ids) throws on native; web, Electron, and Node already provide it, so this
// shim only ever runs there. Math.random is adequate: these ids are local,
// single-user primary keys that need uniqueness, not unpredictability.

type Uuid = `${string}-${string}-${string}-${string}-${string}`

function randomUUID(): Uuid {
  const bytes = new Uint8Array(16)
  for (let i = 0; i < bytes.length; i++) bytes[i] = (Math.random() * 256) | 0
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  let hex = ''
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as Uuid
}

const existing = (globalThis as { crypto?: Partial<Crypto> }).crypto
if (typeof existing?.randomUUID !== 'function') {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { ...(existing ?? {}), randomUUID },
  })
}
