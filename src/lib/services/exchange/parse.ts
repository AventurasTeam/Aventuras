import { envelopeSchema, payloadSchemas } from './schemas'
import { checkFormatVersion } from './version'
import type { ExchangeDocument, ExchangeEntity, ExchangeParseResult } from './types'
import { EXCHANGE_FORMAT } from './types'

const ENTITIES: ExchangeEntity[] = ['character', 'lorebook', 'scenario']

function isEntity(value: string): value is ExchangeEntity {
  return (ENTITIES as string[]).includes(value)
}

/**
 * Exchange-first classification of an import file. Anything without the marker is `external`
 * and belongs to the caller's existing path; anything with the marker is ours to accept or
 * reject, and never falls through.
 */
export function parseExchange<E extends ExchangeEntity>(
  text: string,
  expected: E,
): ExchangeParseResult<E> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { kind: 'external' }
  }
  return classifyExchange(raw, expected)
}

export function classifyExchange<E extends ExchangeEntity>(
  raw: unknown,
  expected: E,
): ExchangeParseResult<E> {
  if (!raw || typeof raw !== 'object' || (raw as { format?: unknown }).format !== EXCHANGE_FORMAT) {
    return { kind: 'external' }
  }

  const envelope = envelopeSchema.safeParse(raw)
  if (!envelope.success) {
    return { kind: 'invalid', error: 'This Aventuras file is missing its format header.' }
  }

  const { formatVersion, entity, exportedAt, data } = envelope.data
  const version = checkFormatVersion(formatVersion)
  if (!version.ok) return { kind: 'invalid', error: version.error }

  if (!isEntity(entity)) {
    return { kind: 'invalid', error: `Unknown Aventuras export type "${entity}".` }
  }
  if (entity !== expected) {
    return {
      kind: 'invalid',
      error: `This file is an Aventuras ${entity} export, not a ${expected}. Import it from the ${entity} section instead.`,
    }
  }

  const payload = payloadSchemas[expected].safeParse(data)
  if (!payload.success) {
    const issue = payload.error.issues[0]
    const where = issue?.path.length ? ` at "${issue.path.join('.')}"` : ''
    return {
      kind: 'invalid',
      error: `This Aventuras ${expected} file is not valid${where}: ${issue?.message ?? 'unknown error'}.`,
    }
  }

  const document = {
    format: EXCHANGE_FORMAT,
    formatVersion,
    entity: expected,
    exportedAt: exportedAt ?? 0,
    data: payload.data,
  } as ExchangeDocument<E>

  return { kind: 'exchange', document, warnings: version.warning ? [version.warning] : [] }
}
