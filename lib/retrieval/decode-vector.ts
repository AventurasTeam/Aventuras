import { unpackFloat32 } from '@/lib/db'

import { VectorInvariantError } from './vector'

// unpackFloat32 lives in lib/db, so its blob-length throw arrives untyped. It
// carries the same meaning as cosine's guards, so it is renamed into the family
// rather than escaping as a generic fault. Not in vector.ts: the ranker's closure
// stays free of lib/db (ranker.test.ts → C4).
export function decodeVector(blob: unknown): Float32Array {
  try {
    return unpackFloat32(blob as Uint8Array)
  } catch (error) {
    throw new VectorInvariantError(error instanceof Error ? error.message : String(error))
  }
}
