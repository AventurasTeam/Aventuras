import type { SyncEnvelope } from '#lib/types/sync.ts'
import { isEnvelopeHeader } from './guards'

/**
 * The header as one JSON line, then the document verbatim.
 *
 * The document is already JSON text. Nesting it as a string inside the envelope, which travels
 * as a string inside the request, would escape every quote twice and cost text-heavy stories
 * much of the server's body limit.
 */
export function encodeEnvelope({ document, ...header }: SyncEnvelope): string {
  return `${JSON.stringify(header)}\n${document}`
}

export function decodeEnvelope(text: string): SyncEnvelope {
  const split = text.indexOf('\n')
  const header: unknown = split < 0 ? null : JSON.parse(text.slice(0, split))
  if (!isEnvelopeHeader(header)) throw new Error('Received an invalid payload')
  return { ...header, document: text.slice(split + 1) }
}
