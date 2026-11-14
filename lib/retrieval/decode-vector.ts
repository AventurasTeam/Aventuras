import { unpackFloat32 } from '@/lib/db'

import { VectorInvariantError } from './vector'

// unpackFloat32's untyped blob-length throw means what cosine's guards mean, so it is renamed into
// that family. Not in vector.ts: the ranker's closure stays free of lib/db (ranker.test.ts → C4).
export function decodeVector(blob: unknown): Float32Array {
  try {
    return unpackFloat32(blob as Uint8Array)
  } catch (error) {
    throw new VectorInvariantError(error instanceof Error ? error.message : String(error))
  }
}
