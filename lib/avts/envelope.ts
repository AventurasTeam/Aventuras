import type { AvtsFileName } from './file-name'

export const AVTS_FORMAT_VERSION = '1.0'
export const AVTS_SUPPORTED_MAJOR = 1

export type AvtsKind = 'entity' | 'lore' | 'thread' | 'happening'

export const AVTS_FORMATS = {
  entity: { format: 'aventuras-entity', payloadKey: 'entity' },
  lore: { format: 'aventuras-lore', payloadKey: 'lore' },
  thread: { format: 'aventuras-thread', payloadKey: 'thread' },
  happening: { format: 'aventuras-happening', payloadKey: 'happening' },
} as const satisfies Record<AvtsKind, { format: `aventuras-${string}`; payloadKey: string }>

/** One import slot's envelope contract: the format, payload key and major of a single kind. */
export function avtsImportSlot<K extends AvtsKind>(kind: K) {
  const { format, payloadKey } = AVTS_FORMATS[kind]
  return { format, payloadKey, supportedMajor: AVTS_SUPPORTED_MAJOR }
}

/** A serialized export, ready for `saveAvtsFile`. */
export type AvtsFile = { readonly fileName: AvtsFileName; readonly contents: string }

/** `{ format, formatVersion, exportedAt, [payloadKey]: payload }`, pretty-printed (2-space). */
export function avtsEnvelope(kind: AvtsKind, payload: unknown, exportedAt: Date): string {
  const { format, payloadKey } = AVTS_FORMATS[kind]
  const envelope = {
    format,
    formatVersion: AVTS_FORMAT_VERSION,
    exportedAt: exportedAt.toISOString(),
    [payloadKey]: payload,
  }
  return JSON.stringify(envelope, null, 2)
}
