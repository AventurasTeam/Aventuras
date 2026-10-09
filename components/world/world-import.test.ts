import { describe, expect, it } from 'vitest'

import { parse, withVersion } from '@/components/compounds/__tests__/import-envelope'
import { flattenIssues } from '@/components/compounds/import-dialog-pipeline'
import { entityExport, loreExport } from '@/lib/avts'
import { emptyEntityState, type Entity, type EntityKind } from '@/lib/db'
import { t } from '@/lib/i18n'
import { makeEntity, makeLore } from '@/lib/list-modules/__tests__/fixtures'

import { entityImportDialog, loreImportDialog } from './world-import'

const EXPORTED_AT = new Date('2026-10-07T12:00:00.000Z')
// Glyph-free: the banner renders the `⚠ ` in its own aria-hidden node.
const NEWER_VERSION = t('common:importDialog.meta.newerVersion')
const KINDS = ['character', 'location', 'item', 'faction'] as const

const ROWS: Record<EntityKind, Entity> = {
  character: makeEntity({
    id: 'char_kael',
    kind: 'character',
    name: 'Kael',
    state: emptyEntityState('character'),
  }),
  location: makeEntity({
    id: 'loc_market',
    kind: 'location',
    name: 'Night Market',
    state: emptyEntityState('location'),
  }),
  item: makeEntity({
    id: 'item_blade',
    kind: 'item',
    name: 'Courier blade',
    state: emptyEntityState('item'),
  }),
  faction: makeEntity({
    id: 'fac_watch',
    kind: 'faction',
    name: 'The Watch',
    state: emptyEntityState('faction'),
  }),
}

const TITLES: Record<EntityKind, string> = {
  character: 'Import character',
  location: 'Import location',
  item: 'Import item',
  faction: 'Import faction',
}

const AETHERIUM = makeLore({
  id: 'lore_aetherium',
  title: 'The Aetherium',
  body: 'A sea of light above the clouds, where the old gods left their tools.',
})

function entityPayload(kind: EntityKind): unknown {
  const envelope = JSON.parse(entityExport(ROWS[kind], EXPORTED_AT).contents) as Record<
    string,
    unknown
  >
  return envelope.entity
}

describe('newer-version copy', () => {
  // Pins the key to canon's line, so a missing key (echoed back by t) can't pass the tests below.
  it('reads as import-dialog.md → Stage 2 words it', () => {
    expect(NEWER_VERSION).toBe('This file is from a newer version. Update Aventuras to import.')
  })
})

describe('entityImportDialog', () => {
  it.each(KINDS)('reads the %s slot as an aventuras-entity envelope with its title', (kind) => {
    const config = entityImportDialog(kind)
    expect([config.format, config.supportedMajor, config.payloadKey, config.title]).toEqual([
      'aventuras-entity',
      1,
      'entity',
      TITLES[kind],
    ])
  })

  it.each(KINDS)('accepts an exported %s through its own slot', (kind) => {
    const config = entityImportDialog(kind)
    const envelope = parse(config, entityExport(ROWS[kind], EXPORTED_AT).contents)
    expect(envelope.kind).toBe('ok')
    if (envelope.kind !== 'ok') return
    expect(config.schema.safeParse(envelope.payload).success).toBe(true)
  })

  it.each(KINDS)(
    'stops a formatVersion 2.0 %s file at Stage 2 with the newer-version banner',
    (kind) => {
      const config = entityImportDialog(kind)
      const raw = withVersion(entityExport(ROWS[kind], EXPORTED_AT).contents, '2.0')
      expect(parse(config, raw)).toEqual({
        kind: 'error',
        copy: NEWER_VERSION,
      })
    },
  )

  it('fails a location file through the Characters slot with one issue at kind', () => {
    const result = entityImportDialog('character').schema.safeParse(entityPayload('location'))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(flattenIssues(result.error.issues)).toEqual([
      { path: 'kind', message: 'Expected a character.' },
    ])
  })

  it.each(KINDS)('refuses every other kind through the %s slot, at kind alone', (slot) => {
    const schema = entityImportDialog(slot).schema
    for (const other of KINDS.filter((kind) => kind !== slot)) {
      const result = schema.safeParse(entityPayload(other))
      expect(result.success).toBe(false)
      if (result.success) continue
      expect(flattenIssues(result.error.issues)).toEqual([
        { path: 'kind', message: t(`common:avts.issue.expectedKind.${slot}`) },
      ])
    }
  })
})

describe('loreImportDialog', () => {
  it('reads an aventuras-lore envelope with its title', () => {
    const config = loreImportDialog()
    expect([config.format, config.supportedMajor, config.payloadKey, config.title]).toEqual([
      'aventuras-lore',
      1,
      'lore',
      'Import lore',
    ])
  })

  it('accepts an exported lore row', () => {
    const config = loreImportDialog()
    const envelope = parse(config, loreExport(AETHERIUM, EXPORTED_AT).contents)
    expect(envelope.kind).toBe('ok')
    if (envelope.kind !== 'ok') return
    expect(config.schema.safeParse(envelope.payload).success).toBe(true)
  })

  it('stops a formatVersion 2.0 file at Stage 2 with the newer-version banner', () => {
    const config = loreImportDialog()
    const raw = withVersion(loreExport(AETHERIUM, EXPORTED_AT).contents, '2.0')
    expect(parse(config, raw)).toEqual({
      kind: 'error',
      copy: NEWER_VERSION,
    })
  })
})
