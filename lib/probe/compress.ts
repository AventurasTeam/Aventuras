import { gunzipSync, gzipSync } from 'fflate'

import type { ProbeCapturePayload } from '@/lib/db'

export type CompressedPayload = { bytes: Uint8Array; uncompressedSize: number }

export class CaptureEncodeError extends Error {
  constructor(cause: unknown) {
    super('probe capture payload could not be encoded', { cause })
    this.name = 'CaptureEncodeError'
  }
}

export class CaptureDecodeError extends Error {
  constructor(cause: unknown) {
    super('probe capture payload could not be decoded', { cause })
    this.name = 'CaptureDecodeError'
  }
}

// Sync rather than CompressionStream: Hermes has neither that nor node:zlib, and
// the write sits on a transaction path that has no await to spend.
export function compressPayload(payload: ProbeCapturePayload): CompressedPayload {
  let json: Uint8Array
  try {
    json = new TextEncoder().encode(JSON.stringify(payload))
  } catch (error) {
    throw new CaptureEncodeError(error)
  }
  // Kept separate from the encode try above, mirroring the decompress side: a
  // deep payload large enough to fail fflate's allocation is a different fault
  // from an unserializable one, and only the cause distinguishes them.
  try {
    return { bytes: gzipSync(json), uncompressedSize: json.length }
  } catch (error) {
    throw new CaptureEncodeError(error)
  }
}

export function decompressPayload(bytes: Uint8Array): unknown {
  let json: Uint8Array
  try {
    json = gunzipSync(bytes)
  } catch (error) {
    throw new CaptureDecodeError(error)
  }
  // Kept separate from the gunzip try above: collapsing them would make a
  // truncated-gzip failure indistinguishable from a bad-JSON one, even via `cause`.
  try {
    return JSON.parse(new TextDecoder().decode(json))
  } catch (error) {
    throw new CaptureDecodeError(error)
  }
}
