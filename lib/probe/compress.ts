import { gunzipSync, gzipSync } from 'fflate'

/** Bytes as stored, plus the pre-compression length `payload_size` records. */
export type CompressedPayload = { bytes: Uint8Array; size: number }

export class CaptureDecodeError extends Error {
  constructor(message: string) {
    super(`probe capture payload could not be decoded: ${message}`)
    this.name = 'CaptureDecodeError'
  }
}

// Sync rather than CompressionStream: Hermes has neither that nor node:zlib, and
// the write sits on a transaction path that has no await to spend.
export function compressPayload(payload: unknown): CompressedPayload {
  const json = new TextEncoder().encode(JSON.stringify(payload))
  return { bytes: gzipSync(json), size: json.length }
}

export function decompressPayload(bytes: Uint8Array): unknown {
  let json: Uint8Array
  try {
    json = gunzipSync(bytes)
  } catch (error) {
    throw new CaptureDecodeError(error instanceof Error ? error.message : String(error))
  }
  try {
    return JSON.parse(new TextDecoder().decode(json))
  } catch (error) {
    throw new CaptureDecodeError(error instanceof Error ? error.message : String(error))
  }
}
