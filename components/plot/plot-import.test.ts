import { describe, expect, it } from 'vitest'

import { parseEnvelope } from '@/components/compounds/import-dialog-pipeline'
import { happeningExport, threadExport } from '@/lib/avts'
import type { Happening, Thread } from '@/lib/db'
import { t } from '@/lib/i18n'

import { happeningImportDialog, threadImportDialog } from './plot-import'

const EXPORTED_AT = new Date('2026-10-07T12:00:00.000Z')
// Glyph-free: the banner renders the `⚠ ` in its own aria-hidden node.
const NEWER_VERSION = t('common:importDialog.meta.newerVersion')

const AMULET: Thread = {
  id: 'thr_amulet',
  branchId: 'br_1',
  title: 'What the amulet wants',
  description: 'The Veilstone reacts to places, not people. Find out why.',
  category: 'mystery',
  icon: 'sparkles',
  status: 'active',
  injectionMode: 'always',
  triggeredAtEntryId: 'e_5',
  resolvedAtEntryId: null,
  embeddingStale: 0,
  createdAt: 1,
  updatedAt: 1,
}

// In-narrative: the export drops `occurredAtEntryId`, so the file is portable.
const AMBUSH: Happening = {
  id: 'hap_ambush',
  branchId: 'br_1',
  title: 'Ambush at the ford',
  description: 'Riders came out of the reeds at dusk.',
  category: 'conflict',
  icon: null,
  temporal: null,
  occurredAtEntryId: 'e_12',
  commonKnowledge: 0,
  embeddingStale: 0,
  createdAt: 1,
  updatedAt: 1,
}

type EnvelopeConfig = { format: string; supportedMajor: number; payloadKey: string }

function parse(config: EnvelopeConfig, raw: string) {
  return parseEnvelope({
    raw,
    format: config.format,
    supportedMajor: config.supportedMajor,
    payloadKey: config.payloadKey,
  })
}

function withVersion(contents: string, formatVersion: string): string {
  const envelope = JSON.parse(contents) as Record<string, unknown>
  return JSON.stringify({ ...envelope, formatVersion })
}

describe('threadImportDialog', () => {
  it('reads an aventuras-thread envelope with its title', () => {
    const config = threadImportDialog()
    expect([config.format, config.supportedMajor, config.payloadKey, config.title]).toEqual([
      'aventuras-thread',
      1,
      'thread',
      'Import thread',
    ])
  })

  it('accepts an exported thread', () => {
    const config = threadImportDialog()
    const envelope = parse(config, threadExport(AMULET, EXPORTED_AT).contents)
    expect(envelope.kind).toBe('ok')
    if (envelope.kind !== 'ok') return
    expect(config.schema.safeParse(envelope.payload).success).toBe(true)
  })

  it('stops a formatVersion 2.0 file at Stage 2 with the newer-version banner', () => {
    const config = threadImportDialog()
    const raw = withVersion(threadExport(AMULET, EXPORTED_AT).contents, '2.0')
    expect(parse(config, raw)).toEqual({
      kind: 'error',
      copy: NEWER_VERSION,
    })
  })
})

describe('happeningImportDialog', () => {
  it('reads an aventuras-happening envelope with its title', () => {
    const config = happeningImportDialog()
    expect([config.format, config.supportedMajor, config.payloadKey, config.title]).toEqual([
      'aventuras-happening',
      1,
      'happening',
      'Import happening',
    ])
  })

  it('accepts an exported in-narrative happening', () => {
    const config = happeningImportDialog()
    const envelope = parse(config, happeningExport(AMBUSH, EXPORTED_AT).contents)
    expect(envelope.kind).toBe('ok')
    if (envelope.kind !== 'ok') return
    expect(config.schema.safeParse(envelope.payload).success).toBe(true)
  })

  it('stops a formatVersion 2.0 file at Stage 2 with the newer-version banner', () => {
    const config = happeningImportDialog()
    const raw = withVersion(happeningExport(AMBUSH, EXPORTED_AT).contents, '2.0')
    expect(parse(config, raw)).toEqual({
      kind: 'error',
      copy: NEWER_VERSION,
    })
  })
})
