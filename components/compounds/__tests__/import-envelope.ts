import { parseEnvelope } from '../import-dialog-pipeline'

/** What a host import dialog config hands parseEnvelope. */
export type EnvelopeConfig = { format: string; supportedMajor: number; payloadKey: string }

/** Parses `raw` the way a host's ImportDialog does under `config`. */
export function parse(config: EnvelopeConfig, raw: string) {
  return parseEnvelope({
    raw,
    format: config.format,
    supportedMajor: config.supportedMajor,
    payloadKey: config.payloadKey,
  })
}

/** An exported envelope restamped with another format version. */
export function withVersion(contents: string, formatVersion: string): string {
  const envelope = JSON.parse(contents) as Record<string, unknown>
  return JSON.stringify({ ...envelope, formatVersion })
}
